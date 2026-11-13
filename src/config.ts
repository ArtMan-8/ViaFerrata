import fs from "node:fs/promises";
import path from "node:path";
import { checkPath } from "./filesystem.ts";
import { parse } from "smol-toml";
import { CommandError, errorCode, errorMessage } from "./diagnostics.ts";

export const categories = ["changes", "specs", "research", "adr"] as const;
export type Category = (typeof categories)[number];
export interface Config {
  root: string;
  documentsRoot: string;
  directories: Record<Category, string>;
  profile: "lite" | "strict";
}

export async function loadConfig(
  rootArgument = process.cwd(),
): Promise<Config> {
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
      errorCode(error) === "ENOENT" ? "E_CONFIG" : "E_IO",
      `Не удалось открыть проект: ${errorMessage(error)}; проверьте --root и viaferrata.toml.`,
      file,
    );
  }
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new CommandError(
      "E_IO",
      `Не удалось прочитать конфигурацию: ${errorMessage(error)}; проверьте доступ.`,
      file,
    );
  }
  const config = parseConfig(root, raw);
  try {
    for (const directory of Object.values(config.directories))
      await checkPath(directory);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(
      "E_IO",
      `${errorMessage(error)}; проверьте каталоги документов.`,
      file,
    );
  }
  return config;
}

export function parseConfig(root: string, raw: string): Config {
  const file = path.join(root, "viaferrata.toml");
  let config: Record<string, unknown>;
  try {
    config = parse(raw);
  } catch (error) {
    throw new CommandError(
      "E_CONFIG",
      `Некорректный TOML: ${errorMessage(error)}; исправьте конфигурацию.`,
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
  if (config.profile !== "lite" && config.profile !== "strict")
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
  ) as Record<Category, string>;
  return { root, documentsRoot, directories, profile: config.profile };
}
