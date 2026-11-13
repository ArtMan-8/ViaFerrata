import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseConfig, type Config } from "../config.ts";
import { checkPath } from "../filesystem.ts";
import { packageRoot } from "../resources.ts";
import { CommandError, errorCode, errorMessage } from "../diagnostics.ts";

export const instructionFiles = [
  fileURLToPath(new URL("instructions/workflow.md", packageRoot)),
  fileURLToPath(new URL("templates/README.md", packageRoot)),
];
const begin = "<!-- viaferrata:begin -->";
const end = "<!-- viaferrata:end -->";
const agentBlock = `${begin}
## ViaFerrata

Прочитай локальные правила проекта. Запусти используемый vf с --help и открой
указанные инструкции и руководство форм из установленного пакета.
Если vf отсутствует в PATH, используй путь к установленному bin.
Прочитай viaferrata.toml; текущий комплект находится в <documents_root>/changes/,
где documents_root по умолчанию — viaferrata. Выбери комплект по текущей задаче.
До Implement согласуй Intent/Spec/Plan; с началом Implement веди Journal.
Validate подтверждает только заявленную структуру, не согласование и завершение.
${end}
`;

export interface InitIO {
  lstat(file: string): Promise<Stats>;
  readFile(file: string): Promise<Buffer>;
  open(
    file: string,
    flags: string,
  ): Promise<Pick<FileHandle, "writeFile" | "close" | "chmod">>;
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
  instructions: string[];
}

async function readTarget(file: string, io: InitIO): Promise<FileState | null> {
  let stat;
  try {
    stat = await io.lstat(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink())
    throw new CommandError(
      "E_UNSUPPORTED",
      "Симлинки не поддерживаются; используйте обычный файл.",
      file,
    );
  if (!stat.isFile())
    throw new CommandError(
      "E_EXISTS",
      "Нужен обычный файл; устраните конфликт типа пути.",
      file,
    );
  return { bytes: await io.readFile(file), stat };
}

function decode(bytes: Buffer, file: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new CommandError(
      "E_UNSUPPORTED",
      "Требуется UTF-8; преобразуйте кодировку без потери текста.",
      file,
    );
  }
}

function append(original: string, addition: string): string {
  const eol = original.match(/\r?\n/)?.[0] ?? "\n";
  const separator = original && !original.endsWith("\n") ? eol : "";
  return original + separator + addition.replaceAll("\n", eol);
}

function agentsText(original: string, file: string): string {
  // Count literal markers as well as full lines: broken marker placement is a conflict.
  const starts = original.split(begin).length - 1;
  const ends = original.split(end).length - 1;
  if (!starts && !ends) return append(original, agentBlock);
  const normalized = original.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const start = normalized.indexOf(begin);
  const finish = normalized.indexOf(end) + end.length;
  const expected = agentBlock.trimEnd();
  if (
    starts === 1 &&
    ends === 1 &&
    (start === 0 || normalized[start - 1] === "\n") &&
    (finish === normalized.length || normalized[finish] === "\n") &&
    normalized.slice(start, finish) === expected
  )
    return original;
  throw new CommandError(
    "E_EXISTS",
    "Блок ViaFerrata изменён или повреждён; проверьте различие, вынесите дополнения за его границы либо согласуйте восстановление блока.",
    file,
  );
}

function ignoreText(original: string, file: string): string {
  const lines = original.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lastRule = lines.findLastIndex(
    (line) => line === "/.viaferrata/" || line === ".viaferrata/",
  );
  if (lastRule < 0) return append(original, "/.viaferrata/\n");
  if (lines.slice(lastRule + 1).some((line) => line.startsWith("!")))
    throw new CommandError(
      "E_EXISTS",
      "После исключения .viaferrata/ есть отрицание; проверьте правила и разместите исключение после отрицаний. Полный синтаксис gitignore не интерпретируется.",
      file,
    );
  return original;
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
      )
        throw new CommandError(
          "E_CONFIG",
          "documents_root пересекается с файлами подключения; выберите отдельный каталог документов.",
          path.join(config.root, "viaferrata.toml"),
        );
      try {
        const stat = await io.lstat(cursor);
        if (stat.isSymbolicLink())
          throw new CommandError(
            "E_UNSUPPORTED",
            "Симлинки в пути документов не поддерживаются; используйте обычный каталог.",
            cursor,
          );
        if (!stat.isDirectory())
          throw new CommandError(
            "E_CONFIG",
            "На месте каталога документов находится файл; исправьте documents_root или путь.",
            cursor,
          );
      } catch (error) {
        // Still check remaining lexical components for collisions with planned files.
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}

async function unchanged(edit: Edit, io: InitIO) {
  const current = await readTarget(edit.file, io);
  const old = edit.before;
  if (old === null && current === null) return;
  if (
    old &&
    current &&
    old.bytes.equals(current.bytes) &&
    old.stat.ino === current.stat.ino &&
    old.stat.dev === current.stat.dev &&
    old.stat.mtimeMs === current.stat.mtimeMs &&
    old.stat.mode === current.stat.mode
  )
    return;
  throw new CommandError(
    "E_EXISTS",
    "Файл изменился после чтения; проверьте изменения и повторите init.",
    edit.file,
  );
}

async function applyEdit(edit: Edit, io: InitIO, completed: string[]) {
  const temporary = path.join(
    path.dirname(edit.file),
    `.vf-init-${randomUUID()}.tmp`,
  );
  let opened = false;
  try {
    const handle = await io.open(temporary, "wx");
    opened = true;
    try {
      await handle.writeFile(edit.after);
      if (edit.before) await handle.chmod(edit.before.stat.mode & 0o777);
    } finally {
      await handle.close();
    }
    await unchanged(edit, io);
    // Rename replaces only a previously checked file. Link publishes a new file exclusively.
    if (edit.before) await io.rename(temporary, edit.file);
    else await io.link(temporary, edit.file);
    completed.push(path.basename(edit.file));
  } finally {
    if (opened) {
      try {
        await io.unlink(temporary);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}

export async function initProject(
  rootArgument: string,
  profile?: Config["profile"],
  {
    io = fs,
    instructions = instructionFiles,
  }: { io?: InitIO; instructions?: string[] } = {},
): Promise<InitResult> {
  const root = path.resolve(rootArgument);
  const completed: string[] = [];
  let currentFile = root;
  try {
    try {
      await checkPath(root, false);
      if (!(await io.lstat(root)).isDirectory())
        throw new CommandError(
          "E_CONFIG",
          "Корень должен быть существующим каталогом; исправьте --root.",
          root,
        );
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
        throw new CommandError(
          "E_CONFIG",
          "Корень не существует; создайте каталог проекта или исправьте --root.",
          root,
        );
      throw error;
    }
    const states = new Map<string, FileState | null>();
    for (const name of [".gitignore", "AGENTS.md", "viaferrata.toml"]) {
      currentFile = path.join(root, name);
      states.set(name, await readTarget(currentFile, io));
    }
    currentFile = path.join(root, "viaferrata.toml");
    const existing = states.get("viaferrata.toml")!;
    if (!existing && !profile)
      throw new CommandError(
        "E_CONFIG",
        "Для новой конфигурации явно выберите профиль: init --profile lite либо strict.",
        currentFile,
      );
    const configBytes =
      existing?.bytes ?? Buffer.from(`profile = "${profile}"\n`);
    const config = parseConfig(root, decode(configBytes, currentFile));
    if (profile && profile !== config.profile)
      throw new CommandError(
        "E_CONFIG",
        "--profile не совпадает с конфигурацией; используйте существующий профиль, init его не меняет.",
        currentFile,
      );
    await checkDocumentDirectories(config, io);
    for (const resource of instructions) {
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
              name === "AGENTS.md"
                ? agentsText(text, currentFile)
                : ignoreText(text, currentFile),
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
      if (!same) await applyEdit(edit, io, completed);
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
          : "E_IO";
    const reason =
      error instanceof CommandError
        ? error.message
        : `${errorMessage(error)}; проверьте доступ и ресурсы пакета.`;
    throw new CommandError(
      code,
      `${reason} Выполненные изменения: ${completed.join(", ") || "нет"}. ${completed.length ? "Частичный результат сохранён; устраните причину и повторите init." : "Файлы проекта не изменены."}`,
      error instanceof CommandError ? error.file : currentFile,
    );
  }
}
