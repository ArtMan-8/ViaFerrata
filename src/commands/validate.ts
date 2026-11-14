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

export async function validateProject(config: Config): Promise<ValidationResult> {
  const discovered = await discoverDocuments(config);
  const read = await readDocuments(discovered.value.files);
  const diagnostics = [...discovered.diagnostics, ...read.diagnostics];

  const documents: ParsedDocument[] = [];
  for (const source of read.value) {
    const parsed = parseDocumentMetadata(source);
    diagnostics.push(...parsed.diagnostics);

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
          config.directories.changes,
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
    diagnostics.push(...body.diagnostics);
    documents.push({ ...source, metadata, body: body.value });
  }

  const indexed = buildDocumentIndex(documents, discovered.value.changeDirectories);
  diagnostics.push(
    ...indexed.diagnostics,
    ...validateBundles(indexed.value, path.relative(config.root, config.directories.changes)),
    ...validateReferences(documents, indexed.value),
  );

  return {
    documents,
    index: indexed.value,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
