import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { findProjectRoot } from "../cli/project.ts";
import { parseConfig, type Config } from "../config.ts";
import { CommandError, errorCode, errorMessage, isFileError } from "../diagnostics.ts";
import { checkPath, writeAndClose } from "../filesystem.ts";
import { instructionFiles, type InstructionFiles } from "../resources.ts";
import { decode, agentsText, ignoreText } from "./init-text.ts";

export interface InitIO {
  lstat(file: string): Promise<Stats>;
  readFile(file: string): Promise<Buffer>;
  open(file: string, flags: string): Promise<Pick<FileHandle, "writeFile" | "close" | "chmod">>;
  rename(from: string, to: string): Promise<void>;
  link(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
}

interface FileState {
  bytes: Buffer;
  stat: Stats;
}

interface Edit {
  file: string;
  before: FileState | null;
  after: Buffer;
}

export interface InitResult {
  config: Config;
  files: { file: string; action: "создан" | "дополнен" | "сохранён" }[];
  instructions: InstructionFiles;
}

async function readTarget(file: string, io: InitIO): Promise<FileState | null> {
  let stat;
  try {
    stat = await io.lstat(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }

    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new CommandError(
      "E_UNSUPPORTED",
      "Симлинки не поддерживаются; используйте обычный файл.",
      file,
    );
  }
  if (!stat.isFile()) {
    throw new CommandError("E_EXISTS", "Нужен обычный файл; устраните конфликт типа пути.", file);
  }

  return { bytes: await io.readFile(file), stat };
}

async function checkDocumentDirectories(config: Config, io: InitIO) {
  for (const directory of Object.values(config.directories)) {
    let cursor = config.root;
    for (const part of path.relative(config.root, directory).split(path.sep)) {
      cursor = path.join(cursor, part);
      if (
        ["AGENTS.md", ".gitignore", "viaferrata.toml"].some(
          (name) => cursor === path.join(config.root, name),
        )
      ) {
        throw new CommandError(
          "E_CONFIG",
          "documents_root пересекается с файлами подключения; выберите отдельный каталог документов.",
          path.join(config.root, "viaferrata.toml"),
        );
      }

      try {
        const stat = await io.lstat(cursor);
        if (stat.isSymbolicLink()) {
          throw new CommandError(
            "E_UNSUPPORTED",
            "Симлинки в пути документов не поддерживаются; используйте обычный каталог.",
            cursor,
          );
        }

        if (!stat.isDirectory()) {
          throw new CommandError(
            "E_CONFIG",
            "На месте каталога документов находится файл; исправьте documents_root или путь.",
            cursor,
          );
        }
      } catch (error) {
        // Still check remaining lexical components for collisions with planned files.
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

async function unchanged(edit: Edit, io: InitIO) {
  const current = await readTarget(edit.file, io);
  const old = edit.before;
  if (old === null && current === null) {
    return;
  }

  if (
    old &&
    current &&
    old.bytes.equals(current.bytes) &&
    old.stat.ino === current.stat.ino &&
    old.stat.dev === current.stat.dev &&
    old.stat.mtimeMs === current.stat.mtimeMs &&
    old.stat.mode === current.stat.mode
  ) {
    return;
  }

  throw new CommandError(
    "E_EXISTS",
    "Файл изменился после чтения; проверьте изменения и повторите init.",
    edit.file,
  );
}

async function applyEdit(edit: Edit, io: InitIO, completed: string[]) {
  const temporary = path.join(path.dirname(edit.file), `.vf-init-${randomUUID()}.tmp`);
  let opened = false;
  let failure: { error: unknown } | undefined;

  try {
    const handle = await io.open(temporary, "wx");
    opened = true;
    await writeAndClose(handle, async () => {
      await handle.writeFile(edit.after);
      if (edit.before) {
        await handle.chmod(edit.before.stat.mode & 0o777);
      }
    });

    await unchanged(edit, io);
    // Rename replaces only a previously checked file. Link publishes a new file exclusively.
    if (edit.before) {
      await io.rename(temporary, edit.file);
      opened = false;
    } else {
      await io.link(temporary, edit.file);
    }

    completed.push(path.basename(edit.file));
  } catch (error) {
    failure = { error };
  }

  if (opened) {
    try {
      await io.unlink(temporary);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw new CommandError(
          isFileError(error) &&
            (!failure ||
              isFileError(failure.error) ||
              (failure.error instanceof CommandError && failure.error.code !== "E_INTERNAL"))
            ? "E_IO"
            : "E_INTERNAL",
          `Не удалось удалить временный файл: ${errorMessage(error)}; проверьте остаток и доступ к нему.${failure ? ` Предыдущая ошибка: ${errorMessage(failure.error)}.` : ""}`,
          temporary,
          {
            cause: new AggregateError(
              failure ? [failure.error, error] : [error],
              "Ошибки операции и очистки",
            ),
          },
        );
      }
    }
  }

  if (failure) {
    throw failure.error;
  }
}

export async function initProject(
  rootArgument: string,
  profile?: Config["profile"],
  {
    io = fs,
    instructions = instructionFiles,
  }: { io?: InitIO; instructions?: InstructionFiles } = {},
): Promise<InitResult> {
  const root = path.resolve(rootArgument);
  const completed: string[] = [];

  let currentFile = root;
  try {
    try {
      await checkPath(root, false, io);
      if (!(await io.lstat(root)).isDirectory()) {
        throw new CommandError(
          "E_CONFIG",
          "Корень должен быть существующим каталогом; исправьте путь init.",
          root,
        );
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
        throw new CommandError(
          "E_CONFIG",
          "Корень не существует; создайте каталог проекта или исправьте путь init.",
          root,
        );
      }

      throw error;
    }

    const states = new Map<string, FileState | null>();
    for (const name of [".gitignore", "AGENTS.md", "viaferrata.toml"]) {
      currentFile = path.join(root, name);
      states.set(name, await readTarget(currentFile, io));
    }

    currentFile = path.join(root, "viaferrata.toml");
    const existing = states.get("viaferrata.toml") ?? null;
    if (!existing && path.dirname(root) !== root) {
      const parent = await findProjectRoot(path.dirname(root), io);
      if (parent) {
        throw new CommandError(
          "E_CONFIG",
          `Вложенное подключение запрещено: проект уже задан в ${parent}; используйте существующий проект.`,
          currentFile,
        );
      }
    }

    if (!existing && !profile) {
      throw new CommandError(
        "E_CONFIG",
        "Для новой конфигурации явно выберите профиль: init --profile lite либо strict.",
        currentFile,
      );
    }

    const configBytes = existing?.bytes ?? Buffer.from(`profile = "${profile}"\n`);
    const config = parseConfig(root, decode(configBytes, currentFile));
    if (profile && profile !== config.profile) {
      throw new CommandError(
        "E_CONFIG",
        "--profile не совпадает с конфигурацией; используйте существующий профиль, init его не меняет.",
        currentFile,
      );
    }

    await checkDocumentDirectories(config, io);

    for (const resource of [instructions.workflow, instructions.templates]) {
      currentFile = resource;
      await io.readFile(resource);
    }

    const edits: Edit[] = [];
    for (const [name, before] of states) {
      currentFile = path.join(root, name);
      const text = before ? decode(before.bytes, currentFile) : "";
      const after =
        name === "viaferrata.toml"
          ? configBytes
          : Buffer.from(
              name === "AGENTS.md" ? agentsText(text, currentFile) : ignoreText(text, currentFile),
            );
      edits.push({ file: currentFile, before, after });
    }

    for (const edit of edits) {
      currentFile = edit.file;
      await unchanged(edit, io);
    }

    const files: InitResult["files"] = [];
    for (const edit of edits) {
      currentFile = edit.file;
      const same = edit.before?.bytes.equals(edit.after);
      if (!same) {
        await applyEdit(edit, io, completed);
      }

      files.push({
        file: path.basename(edit.file),
        action: same ? "сохранён" : edit.before ? "дополнен" : "создан",
      });
    }

    return { config, files, instructions };
  } catch (error) {
    const code =
      error instanceof CommandError
        ? error.code
        : errorCode(error) === "EEXIST"
          ? "E_EXISTS"
          : isFileError(error)
            ? "E_IO"
            : "E_INTERNAL";

    const reason =
      error instanceof CommandError
        ? error.message
        : `${errorMessage(error)}; проверьте доступ и ресурсы пакета.`;

    throw new CommandError(
      code,
      `${reason} Выполненные изменения: ${completed.join(", ") || "нет"}. ${completed.length ? "Частичный результат сохранён; устраните причину и повторите init." : "Целевые файлы подключения не изменены."}`,
      error instanceof CommandError ? error.file : currentFile,
      { cause: error },
    );
  }
}
