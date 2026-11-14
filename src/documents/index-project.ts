import type { Config } from "../config.ts";
import { sortDiagnostics } from "../diagnostics.ts";
import { discoverDocuments, readDocuments } from "./discover.ts";
import { buildDocumentIndex } from "./index.ts";
import { readDocumentIdentity } from "./metadata.ts";
import type { IndexedDocument } from "./types.ts";

// new needs valid identities and duplicate detection, not full document validation.
export async function indexProject(config: Config) {
  const discovered = await discoverDocuments(config);
  const read = await readDocuments(discovered.value.files);
  const diagnostics = [...discovered.diagnostics, ...read.diagnostics];

  const documents: IndexedDocument[] = read.value.map((source) => {
    const metadata = readDocumentIdentity(source);
    diagnostics.push(...metadata.diagnostics);
    return { ...source, metadata: metadata.value };
  });

  const index = buildDocumentIndex(documents);
  diagnostics.push(...index.diagnostics);

  return {
    documents,
    index: index.value,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
