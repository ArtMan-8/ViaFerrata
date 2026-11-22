import path from "node:path";

import type { Config } from "../config.ts";
import { diagnostic, sortDiagnostics } from "../diagnostics.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { discoverDocuments, readDocuments } from "../documents/discover.ts";
import { buildDocumentIndex, validateBundles } from "../documents/index.ts";
import { parseDocumentBody } from "../documents/markdown.ts";
import { parseDocumentMetadata } from "../documents/metadata.ts";
import { validateReferences } from "../documents/references.ts";
import type { ParsedDocument, DocumentIndex } from "../documents/types.ts";

export interface ValidationResult {
  documents: ParsedDocument[];
  index: DocumentIndex<ParsedDocument>;
  diagnostics: Diagnostic[];
}

function validateArchiveChanges(index: DocumentIndex<ParsedDocument>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [change, bundle] of index.bundles) {
    const archived = [...bundle.values()].filter((doc) => doc.archived);
    const execution = bundle.get("plan")?.metadata?.fields.execution;
    if (
      archived.length &&
      (archived.length !== bundle.size || !["completed", "cancelled"].includes(String(execution)))
    ) {
      diagnostics.push(
        diagnostic(
          archived[0].file,
          "E_ARCHIVE_STATE",
          `${change}: перенос неполон или execution не completed/cancelled; сверьте оба расположения.`,
        ),
      );
    }

    const spec = bundle.get("spec");
    if (!archived.length && execution === "completed" && spec?.body?.deltas?.length) {
      diagnostics.push(
        diagnostic(
          spec.file,
          "W_SYNC_PENDING",
          `${change}: завершите сверку SRS и архивирование; расположение не показывает, применена ли дельта.`,
        ),
      );
    }
  }

  return diagnostics;
}

function validatePlanCoverage(index: DocumentIndex<ParsedDocument>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [change, bundle] of index.bundles) {
    const plan = bundle.get("plan"),
      spec = bundle.get("spec"),
      intent = bundle.get("intent");
    if (!plan?.body || !spec?.body || plan.archived || spec.archived) {
      continue;
    }

    const targets = new Set<string>();
    for (const edges of plan.body.covers?.values() ?? []) {
      for (const target of edges) {
        targets.add(target);
        const prefix = change + "/intent/";
        if (target.startsWith(prefix)) {
          for (const requirement of intent?.body?.covers?.get(target.slice(prefix.length)) ?? []) {
            targets.add(requirement);
          }
        }
      }
    }

    for (const local of spec.body.locals) {
      const id = change + "/spec/" + local;
      if (local.startsWith("R-") && !targets.has(id)) {
        diagnostics.push(
          diagnostic(
            plan.file,
            "E_PLAN_COVERAGE",
            `Нет шага Plan для ${id}; добавьте Covers на требование или покрывающий его AC этой задачи.`,
          ),
        );
      }
    }
  }

  return diagnostics;
}

export async function validateProject(config: Config): Promise<ValidationResult> {
  const discovered = await discoverDocuments(config);
  const read = await readDocuments(discovered.value.files);
  const diagnostics = [...discovered.diagnostics, ...read.diagnostics];

  const documents: ParsedDocument[] = [];
  for (const source of read.value) {
    const parsed = parseDocumentMetadata(source);
    diagnostics.push(
      ...parsed.diagnostics.flatMap((item) => {
        const form = ["E_DATE", "E_FIELD", "E_ENUM", "W_UNKNOWN_FIELD", "W_FORM"].includes(
          item.code,
        );

        if (!form) {
          return [item];
        }

        return source.archived
          ? []
          : [{ ...item, code: "W_FORM" as const, severity: "warning" as const }];
      }),
    );

    const metadata = parsed.value;
    if (!metadata) {
      documents.push({ ...source, metadata: null, body: null });
      continue;
    }

    const expectedCategory = metadata.identity.change
      ? "changes"
      : metadata.identity.type === "srs"
        ? "specs"
        : metadata.identity.type;

    const expectedPath = metadata.identity.change
      ? path.join(
          source.archived
            ? path.join(config.documentsRoot, "archive", "changes")
            : config.directories.changes,
          metadata.identity.change,
          `${metadata.identity.type}.md`,
        )
      : null;

    if (
      source.category !== expectedCategory ||
      (expectedPath && expectedPath !== source.absolute)
    ) {
      diagnostics.push(
        diagnostic(
          source.file,
          "E_LOCATION",
          "Путь не соответствует ID/типу; перенесите документ в соответствующий каталог.",
        ),
      );
    }

    const body = parseDocumentBody(source, metadata);
    diagnostics.push(
      ...body.diagnostics.flatMap((item) => {
        if (item.code === "E_DRAFT_PLACEHOLDER") {
          return source.archived ? [] : [item];
        }

        if (!["E_STRUCTURE", "W_FORM"].includes(item.code)) {
          return [item];
        }

        return source.archived
          ? []
          : [{ ...item, code: "W_FORM" as const, severity: "warning" as const }];
      }),
    );

    if (source.archived && !metadata.identity.change) {
      const allowed =
        metadata.identity.type === "research"
          ? ["completed", "cancelled", "superseded"]
          : ["cancelled", "superseded"];

      if (!allowed.includes(String(metadata.fields.status))) {
        diagnostics.push(
          diagnostic(
            source.file,
            "E_ARCHIVE_STATE",
            "Архив требует допустимого конечного status; восстановите состояние или расположение.",
          ),
        );
      }
    }

    documents.push({ ...source, metadata, body: body.value });
  }

  const indexed = buildDocumentIndex(documents, discovered.value.changeDirectories);
  diagnostics.push(
    ...indexed.diagnostics,
    ...validateBundles(indexed.value, path.relative(config.root, config.directories.changes)),
    ...validateReferences(documents, indexed.value),
    ...validateArchiveChanges(indexed.value),
    ...(config.planCoverage ? validatePlanCoverage(indexed.value) : []),
  );

  return {
    documents,
    index: indexed.value,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
