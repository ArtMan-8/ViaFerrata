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
import { archiveRules } from "../rules/archive.ts";
import { coverageRules } from "../rules/coverage.ts";
import { identityRules } from "../rules/identity.ts";

export interface ValidationResult {
  documents: ParsedDocument[];
  index: DocumentIndex<ParsedDocument>;
  diagnostics: Diagnostic[];
}

function validateArchiveChanges(
  documents: ParsedDocument[],
  index: DocumentIndex<ParsedDocument>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const filesByChange = Map.groupBy(documents, (doc) => doc.metadata?.identity.change);
  for (const [change, bundle] of index.bundles) {
    const files = filesByChange.get(change) ?? [];
    const archived = files.find((doc) => doc.archived);
    const execution = bundle.get("plan")?.metadata?.fields.execution;
    if (archived && files.some((doc) => !doc.archived)) {
      diagnostics.push(
        diagnostic(
          archived.file,
          archiveRules.archiveChangeLocation,
          `${change}: документы комплекта находятся в двух расположениях; сверьте перенос.`,
        ),
      );
    }

    if (archived && !["completed", "cancelled"].includes(String(execution))) {
      diagnostics.push(
        diagnostic(
          bundle.get("plan")?.file ?? archived.file,
          archiveRules.archiveChangeExecution,
          `${change}: в архиве у Plan требуется execution completed или cancelled; проверьте состояние задачи.`,
        ),
      );
    }

    const spec = bundle.get("spec");
    if (!archived && execution === "completed" && spec?.body?.deltas?.length) {
      diagnostics.push(
        diagnostic(
          spec.file,
          archiveRules.pendingSynchronization,
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
            coverageRules.planRequirementCoverage,
            `Нет шага Plan для ${id}; добавьте Covers на требование или покрывающий его AC этой задачи.`,
          ),
        );
      }
    }
  }

  return diagnostics;
}

function applicableDiagnostics(items: Diagnostic[], archived = false): Diagnostic[] {
  return archived
    ? items.filter((item) => item.code !== "W_FORM" && item.code !== "E_DRAFT_PLACEHOLDER")
    : items;
}

export async function validateProject(config: Config): Promise<ValidationResult> {
  const discovered = await discoverDocuments(config);
  const read = await readDocuments(discovered.value.files);
  const diagnostics = [...discovered.diagnostics, ...read.diagnostics];

  const documents: ParsedDocument[] = [];
  for (const source of read.value) {
    const parsed = parseDocumentMetadata(source);
    diagnostics.push(...applicableDiagnostics(parsed.diagnostics, source.archived));

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
          identityRules.documentLocation,
          "Путь не соответствует ID/типу; перенесите документ в соответствующий каталог.",
        ),
      );
    }

    const body = parseDocumentBody(source, metadata);
    diagnostics.push(...applicableDiagnostics(body.diagnostics, source.archived));

    if (source.archived && !metadata.identity.change) {
      const allowed =
        metadata.identity.type === "research"
          ? ["completed", "cancelled", "superseded"]
          : ["cancelled", "superseded"];

      if (!allowed.includes(String(metadata.fields.status))) {
        diagnostics.push(
          diagnostic(
            source.file,
            archiveRules.archiveDocumentState,
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
    ...validateArchiveChanges(documents, indexed.value),
    ...(config.enabledRules.has(coverageRules.planRequirementCoverage.id)
      ? validatePlanCoverage(indexed.value)
      : []),
  );

  return {
    documents,
    index: indexed.value,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
