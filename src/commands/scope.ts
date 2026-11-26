import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Config } from "../config.ts";
import { CommandError, errorCode, errorMessage, isFileError } from "../diagnostics.ts";
import { topLevelMarkdownNodes } from "../documents/markdown-nodes.ts";
import { requireDocumentIdentity } from "../documents/metadata.ts";
import { requiredChangeTypes } from "../documents/schema.ts";
import { markdownSections, parseYamlFence } from "../documents/yaml-blocks.ts";
import { checkPath } from "../filesystem.ts";
import { changedPaths } from "./scope.git.ts";

function treeOrder(left: string, right: string) {
  const a = left.split("/");
  const b = right.split("/");
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const leaf = Number(i === a.length - 1) - Number(i === b.length - 1);
    if (leaf) {
      return leaf;
    }

    const folded = Buffer.from(a[i].toLowerCase()).compare(Buffer.from(b[i].toLowerCase()));
    const order = folded || Buffer.from(a[i]).compare(Buffer.from(b[i]));
    if (order) {
      return order;
    }
  }

  return 0;
}

function scopePatterns(value: unknown, file: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.length) {
    throw new CommandError(
      "E_FIELD",
      "Запишите scope непустым списком масок или опустите поле.",
      file,
    );
  }

  const masks: string[] = [];
  for (const mask of value) {
    if (
      typeof mask !== "string" ||
      !mask.trim() ||
      /^[a-z]:/i.test(mask) ||
      /[\\?[\]{}\0]/.test(mask) ||
      mask
        .split("/")
        .some(
          (part, i, parts) =>
            !part ||
            part === "." ||
            part === ".." ||
            (part.includes("**") && !(part === "**" && i > 0 && i === parts.length - 1)),
        )
    ) {
      throw new CommandError(
        "E_FIELD",
        `Недопустимая маска scope ${JSON.stringify(mask)}. Используйте относительный путь, * или конечное /**.`,
        file,
      );
    }

    masks.push(mask);
  }

  return masks.sort(treeOrder);
}

function matches(mask: string[], parts: string[]) {
  for (let i = 0; i < mask.length; i++) {
    if (i >= parts.length) {
      return false;
    }

    if (mask[i] === "**") {
      return true;
    }

    // Match literal runs between stars without interpreting Git pathspecs.
    const runs = mask[i].split("*");
    const first = runs.shift()!;
    if (!runs.length) {
      if (parts[i] !== first) {
        return false;
      }

      continue;
    }

    const last = runs.pop()!;
    const name = parts[i];
    if (!name.startsWith(first) || !name.endsWith(last)) {
      return false;
    }

    let cursor = first.length;
    for (const run of runs) {
      const offset = name.indexOf(run, cursor);
      if (offset < 0) {
        return false;
      }

      cursor = offset + run.length;
    }

    if (cursor > name.length - last.length) {
      return false;
    }
  }

  return mask.length === parts.length;
}

async function readArtifact(directory: string, change: string, kind: "spec" | "journal") {
  const file = path.join(directory, kind + ".md");
  try {
    await checkPath(file, false);
    if (!(await fs.lstat(file)).isFile()) {
      throw new CommandError("E_IO", "Требуется обычный файл.", file);
    }

    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(file));
    const metadata = requireDocumentIdentity({ file, raw }, change + "/" + kind);
    return { file, fields: metadata.fields, body: raw.slice(metadata.bodyOffset) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new CommandError(
        "E_DOCUMENT_NOT_FOUND",
        `Запрошенный документ ${change}/${kind} не найден.`,
        file,
      );
    }

    if (!isFileError(error) && errorCode(error) !== "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw error;
    }

    throw new CommandError("E_IO", `Проверьте рабочий комплект: ${errorMessage(error)}`, file);
  }
}

function approval(body: string, file: string, digest: string) {
  const fields = new Map<string, unknown>();
  for (const { section, blocks } of markdownSections(topLevelMarkdownNodes(body))) {
    if (section !== "Significant Events") {
      continue;
    }

    for (const fence of blocks) {
      const { document, closed } = parseYamlFence(fence, body, "markdown");
      if (!closed || document.errors.length || document.warnings.length) {
        throw new CommandError("E_YAML", "Исправьте блок YAML в Significant Events.", file);
      }

      let value: unknown;
      try {
        value = document.toJS();
      } catch (error) {
        throw new CommandError("E_YAML", `Исправьте блок YAML: ${errorMessage(error)}`, file);
      }

      if (!value || typeof value !== "object") {
        continue;
      }

      for (const [key, item] of Object.entries(value)) {
        if (key !== "decisions" && key !== "scope_check") {
          continue;
        }

        if (fields.has(key)) {
          throw new CommandError("E_FIELD", `Оставьте одну запись ${key}.`, file);
        }

        fields.set(key, item);
      }
    }
  }

  const decisions = fields.get("decisions");
  if (
    !Array.isArray(decisions) ||
    !decisions.length ||
    decisions.some((d) => typeof d !== "string" || !d.trim())
  ) {
    throw new CommandError("E_FIELD", "Запишите основание согласования в decisions.", file);
  }

  const data = fields.get("scope_check");
  if (
    !data ||
    typeof data !== "object" ||
    !("base" in data) ||
    typeof data.base !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(data.base)
  ) {
    throw new CommandError(
      "E_FIELD",
      "Укажите полный SHA исходного коммита в scope_check.base.",
      file,
    );
  }

  if (!("digest" in data) || data.digest !== digest) {
    throw new CommandError(
      "E_SCOPE",
      "Сумма scope расходится с Journal. Восстановите принятую область или согласуйте и запишите дельту перед обновлением digest.",
      file,
    );
  }

  return data.base;
}

export async function checkScope(config: Config, change: string, digestOnly: boolean) {
  const directory = path.join(config.directories.changes, change);
  const spec = await readArtifact(directory, change, "spec");
  const masks = scopePatterns(spec.fields.scope, spec.file);
  const digest = createHash("sha256").update(JSON.stringify(masks)).digest("hex");
  if (digestOnly) {
    return digest;
  }

  const journal = await readArtifact(directory, change, "journal");
  const base = approval(journal.body, journal.file, digest);
  const relative = path.relative(config.root, directory).split(path.sep).join("/");
  const own = new Set(
    [...requiredChangeTypes, "journal"].map((kind) => relative + "/" + kind + ".md"),
  );
  const patterns = masks.map((mask) => mask.split("/"));
  return changedPaths(config.root, base, (name) => {
    const parts = name.split("/");
    return own.has(name) || patterns.some((mask) => matches(mask, parts));
  });
}
