import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "smol-toml";
import { CommandError } from "./diagnostics.js";

export const categories = ["changes", "specs", "research", "adr"];

// Check each existing component before reading/writing; no symlink traversal.
export async function checkPath(target, missingAllowed = true) {
  const absolute = path.resolve(target);
  const { root } = path.parse(absolute);
  let cursor = root;
  for (const component of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink())
        throw new CommandError(
          "E_UNSUPPORTED",
          "Симлинки не поддерживаются; используйте обычный путь.",
          cursor,
        );
    } catch (error) {
      if (error.code === "ENOENT" && missingAllowed) return;
      throw error;
    }
  }
}

export async function loadConfig(rootArgument = process.cwd()) {
  const root = path.resolve(rootArgument);
  const file = path.join(root, "viaferrata.toml");
  try {
    await checkPath(root, false);
    if (!(await fs.stat(root)).isDirectory())
      throw new CommandError(
        "E_CONFIG",
        "Корень должен быть каталогом; исправьте --root.",
        file,
      );
    await checkPath(file, false);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(
      error.code === "ENOENT" ? "E_CONFIG" : "E_IO",
      `Не удалось открыть проект: ${error.message}; проверьте --root и viaferrata.toml.`,
      file,
    );
  }
  let config;
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new CommandError(
      "E_IO",
      `Не удалось прочитать конфигурацию: ${error.message}; проверьте доступ.`,
      file,
    );
  }
  try {
    config = parse(raw);
  } catch (error) {
    throw new CommandError(
      "E_CONFIG",
      `Некорректный TOML: ${error.message}; исправьте конфигурацию.`,
      file,
    );
  }
  const allowed = new Set([
    "profile",
    "documents_root",
    "protected_paths",
    "required_checks",
  ]);
  for (const key of Object.keys(config))
    if (!allowed.has(key))
      throw new CommandError(
        "E_CONFIG",
        `Неизвестный ключ ${key}; удалите или исправьте его.`,
        file,
      );
  if (!["lite", "strict"].includes(config.profile))
    throw new CommandError(
      "E_CONFIG",
      "profile должен быть lite или strict.",
      file,
    );
  const relative = config.documents_root ?? "viaferrata";
  if (
    typeof relative !== "string" ||
    !relative.trim() ||
    path.isAbsolute(relative) ||
    /[\\*?\[\]{}\x00-\x1f]/.test(relative) ||
    relative
      .split("/")
      .some((p) =>
        [".", "..", ".git", ".viaferrata", "node_modules"].includes(p),
      )
  ) {
    throw new CommandError(
      "E_CONFIG",
      "documents_root должен быть непустым относительным путём, не состоящим только из пробелов, без glob, служебных каталогов и . или ..; исправьте путь.",
      file,
    );
  }
  for (const key of ["protected_paths", "required_checks"]) {
    const value = config[key] ?? [];
    if (
      !Array.isArray(value) ||
      value.some((v) => typeof v !== "string" || !v.trim())
    )
      throw new CommandError(
        "E_CONFIG",
        `${key} должен быть массивом непустых строк.`,
        file,
      );
    if (value.length)
      throw new CommandError(
        "E_UNSUPPORTED",
        `${key} ещё не поддерживается этим срезом; используйте реализацию нужного контроля, не отключайте обязательства ради проверки.`,
        file,
      );
  }
  const documentsRoot = path.join(root, relative);
  const directories = Object.fromEntries(
    categories.map((c) => [c, path.join(documentsRoot, c)]),
  );
  try {
    for (const directory of Object.values(directories))
      await checkPath(directory);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(
      "E_IO",
      `${error.message}; проверьте каталоги документов.`,
      file,
    );
  }
  return { root, documentsRoot, directories, profile: config.profile };
}
