import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DraftType } from "../cli/arguments.ts";
import type { Config } from "../config.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { CommandError, errorCode, errorMessage, isFileError, exitCode } from "../diagnostics.ts";
import { indexProject } from "../documents/index-project.ts";
import { requiredChangeTypes } from "../documents/schema.ts";
import { checkPath, writeAndClose } from "../filesystem.ts";
import { packageRoot } from "../resources.ts";

const templateRoot = fileURLToPath(new URL("templates/", packageRoot));

export interface ChangeIO extends Pick<typeof fs, "rename" | "link" | "rm"> {
  mkdtemp(prefix: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  mkdir(path: string): Promise<unknown>;
  lstat(path: string): Promise<Stats>;
  open(path: string, flags: string): Promise<Pick<FileHandle, "writeFile" | "close">>;
}

interface CreateOptions {
  io?: ChangeIO;
  now?: () => Date;
  templates?: string;
}

interface CreateResult {
  id: string | null;
  created: string[];
  diagnostics: Diagnostic[];
}

export async function createDraft(
  config: Config,
  type: DraftType,
  title: string,
  { io = fs, now = () => new Date(), templates = templateRoot }: CreateOptions = {},
): Promise<CreateResult> {
  if (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title)) {
    throw new CommandError(
      "E_CLI_COMMAND_USAGE",
      "Название должно быть непустой строкой без перевода строки; укажите одно название.",
      "vf",
    );
  }

  const inspected = await indexProject(config);
  if (exitCode(inspected.diagnostics)) {
    return { diagnostics: inspected.diagnostics, created: [], id: null };
  }

  const directory =
    config.directories[type === "change" ? "changes" : type === "srs" ? "specs" : type];
  let highest = 0;
  for (const document of inspected.documents) {
    const identity = document.metadata?.identity;
    const id = type === "change" ? identity?.change : identity?.id;
    if (id?.startsWith(type + "-")) {
      highest = Math.max(highest, Number(id.slice(type.length + 1)));
    }
  }

  if (type === "change") {
    for (const indexedDirectory of [
      config.directories.changes,
      path.join(config.documentsRoot, "archive", "changes"),
    ]) {
      try {
        for (const name of await io.readdir(indexedDirectory)) {
          if (/^change-\d{6}$/.test(name)) {
            highest = Math.max(highest, Number(name.slice(7)));
          }
        }
      } catch (error) {
        if (!isFileError(error)) {
          throw error;
        }

        if (errorCode(error) !== "ENOENT") {
          throw new CommandError(
            "E_IO",
            `${errorMessage(error)}; проверьте доступ к changes.`,
            indexedDirectory,
          );
        }
      }
    }
  }

  if (highest >= 999999) {
    throw new CommandError(
      "E_ID_EXHAUSTED",
      `Диапазон ${type}-000001…${type}-999999 исчерпан; требуется отдельное решение по диапазону ID.`,
      directory,
    );
  }

  const id = `${type}-${String(highest + 1).padStart(6, "0")}`;
  const destination = path.join(directory, type === "change" ? id : id + ".md");
  const date = now().toISOString().slice(0, 10);
  const values: Record<string, string> = {
    [type === "change" ? "change_id" : "document_id"]: id,
    date,
    title: title.replace(/[\\`*_{}[\]()#+.!<>|~-]/g, "\\$&"),
  };

  const rendered: string[] = [];
  const forms = type === "change" ? requiredChangeTypes : [type];
  for (const form of forms) {
    const template = path.join(templates, `${form}.md`);
    let source;
    try {
      source = await io.readFile(template, "utf8");
    } catch (error) {
      if (!isFileError(error)) {
        throw error;
      }

      throw new CommandError(
        "E_IO",
        `Не удалось прочитать шаблон: ${errorMessage(error)}; восстановите пакет.`,
        template,
      );
    }

    rendered.push(
      source.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
        if (!Object.hasOwn(values, key)) {
          throw new CommandError(
            "E_UNSUPPORTED",
            `Неизвестный параметр шаблона ${key}; восстановите совместимые шаблоны.`,
            template,
          );
        }

        return values[key];
      }),
    );
  }

  let staging: string | undefined;
  let writing = destination;
  let failure: CommandError | undefined;
  try {
    await checkPath(destination, true, io);

    let cursor = config.root;
    for (const component of path.relative(config.root, directory).split(path.sep)) {
      cursor = path.join(cursor, component);
      try {
        await io.mkdir(cursor);
      } catch (error) {
        if (errorCode(error) !== "EEXIST" || !(await io.lstat(cursor)).isDirectory()) {
          throw error;
        }
      }
    }

    staging = await io.mkdtemp(path.join(config.documentsRoot, ".vf-new-"));
    for (const [i, form] of forms.entries()) {
      writing = path.join(staging, form + ".md");
      const handle = await io.open(writing, "wx");
      await writeAndClose(handle, () => handle.writeFile(rendered[i], "utf8"));
    }

    writing = destination;
    if (type === "change") {
      try {
        await io.lstat(destination);
        throw new CommandError("E_CONFLICT", "Путь уже занят.", destination);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }

      await io.rename(staging, destination);
      staging = undefined;
    } else {
      await io.link(path.join(staging, type + ".md"), destination);
    }
  } catch (error) {
    const code =
      error instanceof CommandError
        ? error.code
        : ["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(errorCode(error) ?? "") &&
            writing === destination
          ? "E_CONFLICT"
          : isFileError(error)
            ? "E_IO"
            : "E_INTERNAL";

    failure = new CommandError(
      code,
      `${id}: ${path.basename(writing)}: ${errorMessage(error)}; проверьте путь и повторите команду.`,
      destination,
      { cause: error },
    );
  }

  if (staging) {
    try {
      await io.rm(staging, { recursive: true, force: true });
    } catch (cleanupError) {
      const state = failure ? failure.message : `Черновик уже опубликован: ${destination}.`;
      throw new CommandError(
        failure?.code ?? (isFileError(cleanupError) ? "E_IO" : "E_INTERNAL"),
        `${state} Не удалось очистить временный каталог: ${errorMessage(cleanupError)}.`,
        staging,
        { cause: failure ? new AggregateError([failure, cleanupError]) : cleanupError },
      );
    }
  }

  if (failure) {
    throw failure;
  }

  return { id, created: [destination], diagnostics: inspected.diagnostics };
}
