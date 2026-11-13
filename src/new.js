import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPath } from "./config.js";
import { inspectDocuments } from "./documents.js";
import { CommandError, exitCode } from "./diagnostics.js";

const templateRoot = fileURLToPath(new URL("../templates/", import.meta.url));
const types = ["intent", "spec", "plan"];

export async function createChange(
  config,
  title,
  { io = fs, now = () => new Date(), templates = templateRoot } = {},
) {
  if (typeof title !== "string" || !title.trim() || /[\r\n]/.test(title))
    throw new CommandError(
      "E_USAGE",
      "Название должно быть непустой строкой без перевода строки; укажите одно название.",
      "vf",
    );
  const inspected = await inspectDocuments(config, { indexOnly: true });
  if (exitCode(inspected.diagnostics))
    return { ...inspected, created: [], id: null };
  let highest = 0;
  for (const document of inspected.documents)
    if (document.identity?.change)
      highest = Math.max(highest, Number(document.identity.change.slice(7)));
  try {
    for (const name of await io.readdir(config.directories.changes))
      if (/^change-\d{6}$/.test(name))
        highest = Math.max(highest, Number(name.slice(7)));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new CommandError(
        "E_IO",
        `${error.message}; проверьте доступ к changes.`,
        config.directories.changes,
      );
  }
  if (highest >= 999999)
    throw new CommandError(
      "E_ID_EXHAUSTED",
      "Диапазон change-000001…change-999999 исчерпан; требуется отдельное решение по диапазону ID.",
      config.directories.changes,
    );
  const id = `change-${String(highest + 1).padStart(6, "0")}`;
  const destination = path.join(config.directories.changes, id);
  const date = now().toISOString().slice(0, 10);
  const values = {
    change_id: id,
    date,
    title: title.replace(/[\\`*_{}[\]()#+.!<>|~-]/g, "\\$&"),
  };
  const rendered = [];
  for (const type of types) {
    const template = path.join(templates, `${type}.md`);
    let source;
    try {
      source = await io.readFile(template, "utf8");
    } catch (error) {
      throw new CommandError(
        "E_IO",
        `Не удалось прочитать шаблон: ${error.message}; восстановите пакет.`,
        template,
      );
    }
    rendered.push(
      source.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
        if (!(key in values))
          throw new CommandError(
            "E_UNSUPPORTED",
            `Неизвестный параметр шаблона ${key}; восстановите совместимые шаблоны.`,
            template,
          );
        return values[key];
      }),
    );
  }
  const created = [];
  try {
    await checkPath(destination);
    let cursor = config.root;
    for (const component of path
      .relative(config.root, config.directories.changes)
      .split(path.sep)) {
      cursor = path.join(cursor, component);
      try {
        await io.mkdir(cursor);
        created.push(cursor);
      } catch (error) {
        if (error.code !== "EEXIST" || !(await io.lstat(cursor)).isDirectory())
          throw error;
      }
    }
    await io.mkdir(destination);
    created.push(destination);
    for (const [i, type] of types.entries()) {
      const target = path.join(destination, `${type}.md`);
      // Record the file after exclusive open, even if its subsequent write fails.
      const handle = await io.open(target, "wx");
      created.push(target);
      try {
        await handle.writeFile(rendered[i], "utf8");
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    const code =
      error instanceof CommandError
        ? error.code
        : error.code === "EEXIST"
          ? "E_EXISTS"
          : "E_IO";
    throw new CommandError(
      code,
      `${error.message}; создано: ${created.map((p) => path.relative(config.root, p)).join(", ") || "ничего"}. Частичный результат сохранён; проверьте его перед продолжением.`,
      destination,
    );
  }
  return { id, created, diagnostics: inspected.diagnostics };
}
