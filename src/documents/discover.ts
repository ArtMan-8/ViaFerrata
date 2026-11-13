import fs from "node:fs/promises";
import path from "node:path";
import { categories } from "../config.ts";
import type { Config, Category } from "../config.ts";
import { diagnostic, errorCode, errorMessage } from "../diagnostics.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { identity } from "./schema.ts";
import type { DocumentFile, ReadDocument, Result } from "./types.ts";

interface Discovery {
  files: DocumentFile[];
  changeDirectories: string[];
}

export async function discoverDocuments(
  config: Config,
): Promise<Result<Discovery>> {
  const diagnostics: Diagnostic[] = [];
  const files: DocumentFile[] = [];
  const changeDirectories: string[] = [];
  async function walk(directory: string, category: Category) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      diagnostics.push(
        diagnostic(
          path.relative(config.root, directory),
          "E_IO",
          `${errorMessage(error)}; проверьте доступ к каталогу.`,
        ),
      );
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        diagnostics.push(
          diagnostic(
            path.relative(config.root, absolute),
            "E_UNSUPPORTED",
            "Симлинки в каталогах документов не поддерживаются; используйте обычные файлы и каталоги.",
          ),
        );
      } else if (entry.isDirectory()) {
        if (
          directory === config.directories.changes &&
          identity(`${entry.name}/intent`)?.change === entry.name
        )
          changeDirectories.push(entry.name);
        if (![".git", ".viaferrata", "node_modules"].includes(entry.name))
          await walk(absolute, category);
      } else if (entry.isFile() && entry.name.endsWith(".md"))
        files.push({
          absolute,
          category,
          file: path.relative(config.root, absolute),
        });
    }
  }
  for (const category of categories)
    await walk(config.directories[category], category);
  return { value: { files, changeDirectories }, diagnostics };
}

export async function readDocuments(
  files: readonly DocumentFile[],
): Promise<Result<ReadDocument[]>> {
  const documents: ReadDocument[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const entry of files) {
    try {
      const raw = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await fs.readFile(entry.absolute));
      documents.push({ ...entry, raw });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          entry.file,
          "E_IO",
          `${errorMessage(error)}; проверьте доступ и UTF-8.`,
        ),
      );
    }
  }
  return { value: documents, diagnostics };
}
