import path from "node:path";

import { diagnostic } from "../diagnostics.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { requiredChangeTypes } from "./schema.ts";
import type { DocumentType, IndexedDocument, DocumentIndex, Result } from "./types.ts";

export function buildDocumentIndex<T extends IndexedDocument>(
  documents: readonly T[],
  changeDirectories: readonly string[] = [],
): Result<DocumentIndex<T>> {
  const diagnostics: Diagnostic[] = [];
  const index = new Map<string, T>();
  const bundles = new Map<string, Map<DocumentType, T>>(
    changeDirectories.map((change) => [change, new Map()]),
  );

  for (const doc of documents) {
    if (!doc.metadata?.identity) {
      continue;
    }

    const { id, change, type } = doc.metadata.identity;
    const other = index.get(id);
    if (other) {
      diagnostics.push(
        diagnostic(
          doc.file,
          "E_DUPLICATE_ID",
          `ID ${id} также объявлен в ${other.file}; устраните дубликат.`,
        ),
      );
      diagnostics.push(
        diagnostic(
          other.file,
          "E_DUPLICATE_ID",
          `ID ${id} также объявлен в ${doc.file}; устраните дубликат.`,
        ),
      );
    } else {
      index.set(id, doc);
    }

    if (change) {
      const bundle = bundles.get(change) ?? new Map<DocumentType, T>();
      bundle.set(type, doc);
      bundles.set(change, bundle);
    }
  }

  return { value: { documents: index, bundles }, diagnostics };
}

export function validateBundles(index: DocumentIndex, changesPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [change, bundle] of index.bundles) {
    const first = bundle.values().next().value;
    for (const type of requiredChangeTypes) {
      if (!bundle.has(type)) {
        const message = `Нет обязательного ${type}.md; восстановите комплект.`;
        if (first) {
          diagnostics.push(diagnostic(first.file, "E_STRUCTURE", message));
        } else {
          diagnostics.push(diagnostic(path.join(changesPath, change), "E_STRUCTURE", message));
        }
      }
    }

    const execution = bundle.get("plan")?.metadata?.fields.execution;
    if (
      first &&
      typeof execution === "string" &&
      ["in_progress", "blocked", "completed"].includes(execution) &&
      !bundle.has("journal")
    ) {
      diagnostics.push(
        diagnostic(
          first.file,
          "E_STRUCTURE",
          "Начатая задача требует Journal; сохраните состояние реализации.",
        ),
      );
    }
  }

  return diagnostics;
}
