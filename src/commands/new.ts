import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Config } from "../config.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { CommandError, errorCode, errorMessage, isFileError, exitCode } from "../diagnostics.ts";
import { indexProject } from "../documents/index-project.ts";
import { requiredChangeTypes } from "../documents/schema.ts";
import { checkPath, writeAndClose } from "../filesystem.ts";
import { packageRoot } from "../resources.ts";

const templateRoot = fileURLToPath(new URL("templates/", packageRoot));

export interface ChangeIO {
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

export async function createChange(
  config: Config,
  title: string,
  { io = fs, now = () => new Date(), templates = templateRoot }: CreateOptions = {},
): Promise<CreateResult> {
  if (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title)) {
    throw new CommandError(
      "E_USAGE",
      "Название должно быть непустой строкой без перевода строки; укажите одно название.",
      "vf",
    );
  }

  const inspected = await indexProject(config);
  if (exitCode(inspected.diagnostics)) {
    return { diagnostics: inspected.diagnostics, created: [], id: null };
  }

  let highest = 0;
  for (const document of inspected.documents) {
    if (document.metadata?.identity?.change) {
      highest = Math.max(highest, Number(document.metadata?.identity.change.slice(7)));
    }
  }

  try {
    for (const name of await io.readdir(config.directories.changes)) {
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
        config.directories.changes,
      );
    }
  }

  if (highest >= 999999) {
    throw new CommandError(
      "E_ID_EXHAUSTED",
      "Диапазон change-000001…change-999999 исчерпан; требуется отдельное решение по диапазону ID.",
      config.directories.changes,
    );
  }

  const id = `change-${String(highest + 1).padStart(6, "0")}`;
  const destination = path.join(config.directories.changes, id);
  const date = now().toISOString().slice(0, 10);
  const values: Record<string, string> = {
    change_id: id,
    date,
    title: title.replace(/[\\`*_{}[\]()#+.!<>|~-]/g, "\\$&"),
  };

  const rendered: string[] = [];
  for (const type of requiredChangeTypes) {
    const template = path.join(templates, `${type}.md`);
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

  const created: string[] = [];
  try {
    await checkPath(destination, true, io);

    let cursor = config.root;
    for (const component of path
      .relative(config.root, config.directories.changes)
      .split(path.sep)) {
      cursor = path.join(cursor, component);
      try {
        await io.mkdir(cursor);
        created.push(cursor);
      } catch (error) {
        if (errorCode(error) !== "EEXIST" || !(await io.lstat(cursor)).isDirectory()) {
          throw error;
        }
      }
    }

    await io.mkdir(destination);

    created.push(destination);
    for (const [i, type] of requiredChangeTypes.entries()) {
      const target = path.join(destination, `${type}.md`);
      // Record the file after exclusive open, even if its subsequent write fails.
      const handle = await io.open(target, "wx");
      created.push(target);
      await writeAndClose(handle, () => handle.writeFile(rendered[i], "utf8"));
    }
  } catch (error) {
    const code =
      error instanceof CommandError
        ? error.code
        : errorCode(error) === "EEXIST"
          ? "E_EXISTS"
          : isFileError(error)
            ? "E_IO"
            : "E_INTERNAL";

    throw new CommandError(
      code,
      `${errorMessage(error)}; создано: ${created.map((p) => path.relative(config.root, p)).join(", ") || "ничего"}. Частичный результат сохранён; проверьте его перед продолжением.`,
      destination,
      { cause: error },
    );
  }

  return { id, created, diagnostics: inspected.diagnostics };
}
