import fs from "node:fs/promises";
import path from "node:path";

import { parse, TomlError } from "smol-toml";

import { CommandError, errorCode, errorMessage, isFileError } from "./diagnostics.ts";
import { checkPath } from "./filesystem.ts";
import { coreRules, strictRules, type Rule, type RuleId } from "./rules.ts";
import { configRules } from "./rules/config.ts";

export const categories = ["changes", "specs", "research", "adr"] as const;

export type Category = (typeof categories)[number];

export interface Config {
  enabledRules: ReadonlySet<RuleId>;
  root: string;
  documentsRoot: string;
  directories: Record<Category, string>;
  profile: "lite" | "strict";
}

export async function loadConfig(rootArgument = process.cwd()): Promise<Config> {
  const root = path.resolve(rootArgument);
  const file = path.join(root, "viaferrata.toml");
  try {
    await checkPath(root, false);
    if (!(await fs.stat(root)).isDirectory()) {
      throw new CommandError(
        "E_CONFIG",
        "Корень должен быть каталогом; исправьте путь проекта.",
        file,
      );
    }

    await checkPath(file, false);
  } catch (error) {
    if (error instanceof CommandError || !isFileError(error)) {
      throw error;
    }

    throw new CommandError(
      errorCode(error) === "ENOENT" ? "E_CONFIG" : "E_IO",
      `Не удалось открыть проект: ${errorMessage(error)}; проверьте каталог проекта и viaferrata.toml.`,
      file,
    );
  }

  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (!isFileError(error)) {
      throw error;
    }

    throw new CommandError(
      "E_IO",
      `Не удалось прочитать конфигурацию: ${errorMessage(error)}; проверьте доступ.`,
      file,
    );
  }

  const config = parseConfig(root, raw);
  try {
    for (const directory of [
      ...Object.values(config.directories),
      ...categories.map((category) => path.join(config.documentsRoot, "archive", category)),
    ]) {
      await checkPath(directory);
    }
  } catch (error) {
    if (error instanceof CommandError || !isFileError(error)) {
      throw error;
    }

    throw new CommandError("E_IO", `${errorMessage(error)}; проверьте каталоги документов.`, file);
  }

  return config;
}

export function documentsRootSetting(value: unknown, file: string): string {
  const relative = value ?? "viaferrata";
  if (
    typeof relative !== "string" ||
    !relative.trim() ||
    path.isAbsolute(relative) ||
    /[\\*?[\]{}\p{Cc}]/u.test(relative) ||
    relative.split("/").some((p) => [".", "..", ".git", ".viaferrata", "node_modules"].includes(p))
  ) {
    throw new CommandError(
      configRules.validDocumentsRoot,
      "documents_root должен быть непустым относительным путём, не состоящим только из пробелов, без glob, обратной косой черты, управляющих символов, служебных каталогов и . или ..; исправьте путь.",
      file,
    );
  }

  return relative;
}

const configFields = {
  documents_root: documentsRootSetting,
  profile(value: unknown, file: string): Config["profile"] {
    if (value !== "lite" && value !== "strict") {
      throw new CommandError(
        configRules.supportedProfile,
        "profile должен быть lite или strict.",
        file,
      );
    }

    return value;
  },
  required_checks(value: unknown, file: string) {
    return stringList(value, "required_checks", file, configRules.validRequiredChecks).map((id) => {
      const rule = strictRules.find((candidate) => candidate.id === id);
      if (!rule) {
        throw new CommandError(
          configRules.selectableCheck,
          `Неизвестная встроенная проверка: ${id}. Допустимы: ${strictRules.map((candidate) => candidate.id).join(", ")}.`,
          file,
        );
      }
      return rule;
    });
  },
};

function stringList(value: unknown, key: string, file: string, rule: Rule): string[] {
  const list = value ?? [];
  if (
    !Array.isArray(list) ||
    !list.every(
      (item: unknown): item is string => typeof item === "string" && item.trim().length > 0,
    )
  ) {
    throw new CommandError(rule, `${key} должен быть массивом непустых строк.`, file);
  }

  return list;
}

export function parseConfig(root: string, raw: string): Config {
  const file = path.join(root, "viaferrata.toml");
  let config: Record<string, unknown>;
  try {
    config = parse(raw);
  } catch (error) {
    if (!(error instanceof TomlError)) {
      throw error;
    }

    throw new CommandError(
      configRules.validToml,
      `Некорректный TOML: ${errorMessage(error)}; исправьте конфигурацию.`,
      file,
    );
  }

  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(configFields, key)) {
      throw new CommandError(
        configRules.knownConfigKeys,
        `Неизвестный ключ ${key}; удалите или исправьте его.`,
        file,
      );
    }
  }

  const profile = configFields.profile(config.profile, file);
  const relative = configFields.documents_root(config.documents_root, file);
  const selected = configFields.required_checks(config.required_checks, file);
  const enabledRules = new Set<RuleId>(
    [...coreRules, ...(profile === "strict" ? strictRules : []), ...selected].map(
      (rule) => rule.id,
    ),
  );
  const documentsRoot = path.join(root, relative);
  const directories = Object.fromEntries(
    categories.map((c) => [c, path.join(documentsRoot, c)]),
  ) as Record<Category, string>;

  return { root, documentsRoot, directories, enabledRules, profile };
}
