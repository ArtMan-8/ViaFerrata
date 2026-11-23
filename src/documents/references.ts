import type { Diagnostic } from "../diagnostics.ts";
import { referenceRules } from "../rules/reference.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { activeMarkdownNodes, plain } from "./markdown-nodes.ts";
import { requiredChangeTypes } from "./schema.ts";
import { addressIdentity } from "./schema.ts";
import type { ParsedDocument, DocumentIndex, Reference } from "./types.ts";

function referencePurpose(raw: string, reference: Reference): string {
  if (reference.key) {
    return reference.key;
  }

  const events = activeMarkdownNodes(raw);
  const parent = events
    .filter(
      (node) =>
        node.type === "listItem" &&
        node.position.start.offset <= reference.offset &&
        node.position.end.offset > reference.offset,
    )
    .find((node) => /^(Covers|Verifies|Changes|Depends on):/.test(plain(node)));

  return parent ? plain(parent).split(":")[0] : "содержательная ссылка";
}

export function validateReferences(
  documents: readonly ParsedDocument[],
  index: DocumentIndex<ParsedDocument>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const doc of documents) {
    if (!doc.metadata) {
      continue;
    }

    const collector = new SourceDiagnostics(doc);
    const execution = doc.metadata.identity.change
      ? index.bundles.get(doc.metadata.identity.change)?.get("plan")?.metadata?.fields.execution
      : undefined;
    const historical = doc.archived || ["completed", "cancelled"].includes(String(execution));
    for (const ref of [...doc.metadata.references, ...(doc.body?.references ?? [])]) {
      const target = addressIdentity(ref.value);
      if (!target) {
        collector.add(
          referenceRules.referenceAddress,
          `Некорректный адрес ${ref.value}; используйте полный логический ID.`,
          ref.offset,
        );

        continue;
      }

      if (
        (ref.key === "research" && (target.type !== "research" || target.local)) ||
        (ref.key === "adr" && (target.type !== "adr" || target.local)) ||
        (ref.key === "supersedes" &&
          (target.type !== doc.metadata.identity.type || target.local || target.bundle))
      ) {
        collector.add(
          referenceRules.referenceType,
          `${ref.key}: неверный тип адресата ${ref.value}; исправьте связь.`,
          ref.offset,
        );
      }

      const bundle = target.bundle ? index.bundles.get(target.bundle) : undefined;
      const document = target.document ? index.documents.get(target.document) : undefined;
      const exists = target.bundle
        ? requiredChangeTypes.every((t) => bundle?.has(t))
        : document && (!target.local || document.body?.locals.has(target.local));
      const purpose = referencePurpose(doc.raw, ref);
      const delta =
        purpose === "Changes"
          ? doc.body?.deltas?.find(
              (item) => item.target === ref.value && item.offset === ref.offset,
            )
          : undefined;
      if (!exists && delta?.operation === "add") {
        continue;
      }

      const removed =
        target.type === "srs" &&
        target.local &&
        [...index.documents.values()].some((candidate) => {
          const plan = candidate.metadata?.identity.change
            ? index.bundles.get(candidate.metadata.identity.change)?.get("plan")
            : undefined;

          return (
            plan?.metadata?.fields.execution === "completed" &&
            candidate.body?.deltas?.some(
              (item) => item.operation === "remove" && item.target === ref.value && item.before,
            )
          );
        });

      if (!exists && historical && target.type === "srs" && target.local) {
        collector.add(
          referenceRules.historicalRevision,
          removed
            ? `${ref.value}: идентичность и Before найдены в дельте remove; редакция на момент события не доказана, используйте Git.`
            : `${ref.value}: историческая редакция не восстановлена; нет сохранённой дельты remove, используйте Git.`,
          ref.offset,
        );

        continue;
      }

      if (exists && historical && target.type === "srs" && target.local && !delta) {
        collector.add(
          referenceRules.historicalRevision,
          `${ref.value}: текущий ID не подтверждает историческую редакцию; используйте дельту или Git.`,
          ref.offset,
        );
      }

      const archivedTarget =
        document?.archived || (bundle && [...bundle.values()].some((item) => item.archived));
      if (exists && !historical && archivedTarget && !["origin", "supersedes"].includes(purpose)) {
        collector.add(
          referenceRules.activeReferenceTarget,
          `${doc.metadata.identity.id} → ${ref.value} (${purpose}): текущая зависимость от архивного документа.`,
          ref.offset,
        );
      }

      if (!exists) {
        collector.add(
          referenceRules.referenceTarget,
          `Нет адресата ${ref.value}; восстановите цель или исправьте ссылку.`,
          ref.offset,
        );
      }
    }

    diagnostics.push(...collector.items);
  }

  return diagnostics;
}
