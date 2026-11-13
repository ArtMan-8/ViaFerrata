import type { Diagnostic } from "../diagnostics.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { addressIdentity } from "./schema.ts";
import type { ParsedDocument, DocumentIndex } from "./types.ts";

export function validateReferences(
  documents: readonly ParsedDocument[],
  index: DocumentIndex<ParsedDocument>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const doc of documents) {
    if (!doc.metadata) continue;
    const collector = new SourceDiagnostics(doc);
    for (const ref of [
      ...doc.metadata.references,
      ...(doc.body?.references ?? []),
    ]) {
      const target = addressIdentity(ref.value);
      if (!target) {
        collector.add(
          "E_REFERENCE_SYNTAX",
          `Некорректный адрес ${ref.value}; используйте полный логический ID.`,
          ref.offset,
        );
        continue;
      }
      if (
        (ref.key === "research" &&
          (target.type !== "research" || target.local)) ||
        (ref.key === "adr" && (target.type !== "adr" || target.local)) ||
        (ref.key === "supersedes" &&
          (target.type !== doc.metadata.identity.type ||
            target.local ||
            target.bundle))
      ) {
        collector.add(
          "E_FIELD",
          `${ref.key}: неверный тип адресата ${ref.value}; исправьте связь.`,
          ref.offset,
        );
      }
      const bundle = target.bundle
        ? index.bundles.get(target.bundle)
        : undefined;
      const document = target.document
        ? index.documents.get(target.document)
        : undefined;
      const exists = target.bundle
        ? (["intent", "spec", "plan"] as const).every((t) => bundle?.has(t))
        : document &&
          (!target.local || document.body?.locals.has(target.local));
      if (!exists)
        collector.add(
          "E_REFERENCE_TARGET",
          `Нет адресата ${ref.value}; восстановите цель или исправьте ссылку.`,
          ref.offset,
        );
    }
    diagnostics.push(...collector.items);
  }
  return diagnostics;
}
