import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import {
  indexProject,
  buildDocumentIndex,
  validateBundles,
} from "../src/documents/index.ts";
import {
  parseDocumentMetadata,
  readDocumentIdentity,
} from "../src/documents/metadata.ts";
import { parseDocumentBody } from "../src/documents/markdown.ts";
import { validateReferences } from "../src/documents/references.ts";
import { validateProject } from "../src/commands/validate.ts";
import { createChange } from "../src/commands/new.ts";
import type { DocumentSource, ParsedDocument } from "../src/documents/types.ts";
import { project, write } from "./helpers.ts";

function source(id: string, body: string, extra = ""): DocumentSource {
  return Object.freeze({
    file: `${id}.md`,
    raw: `---\nid: ${id}\nstatus: draft\ncreated: "2026-11-13"\nupdated: "2026-11-13"\n${extra}---\n${body}`,
  });
}

function parse(input: DocumentSource): ParsedDocument {
  const metadata = parseDocumentMetadata(input);
  assert(metadata.value);
  assert.deepEqual(metadata.diagnostics, []);
  const body = parseDocumentBody(input, metadata.value);
  assert.deepEqual(body.diagnostics, []);
  return {
    ...input,
    absolute: `/project/${input.file}`,
    category: "changes",
    metadata: metadata.value,
    body: body.value,
  };
}

const intentBody =
  "# Задача\n\n## Goal\nЦель.\n\n## Constraints\nОграничения.\n\n## Context\nКонтекст.\n\n## Acceptance Criteria\n\n### AC-1: Условие\n\n- Verification: Проверить.\n";

test("metadata and Markdown parsers preserve input and return independent results", () => {
  const input = source(
    "change-000042/intent",
    intentBody + "\n[srs-000007/R-1]\n",
  );
  const metadata = parseDocumentMetadata(input);
  assert(metadata.value);
  Object.freeze(metadata.value);
  Object.freeze(metadata.value.fields);
  const before = structuredClone(metadata);
  const first = parseDocumentBody(input, metadata.value);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual([...first.value.locals], ["AC-1"]);
  assert.equal(first.value.references[0].value, "srs-000007/R-1");
  assert.deepEqual(parseDocumentBody(input, metadata.value), first);
  assert.deepEqual(metadata, before);
  assert.deepEqual(parseDocumentMetadata(input), metadata);
  const unrelated = source("research-000001", "# Другая задача\n");
  const second = parse(unrelated);
  assert.equal(second.body?.locals.size, 0);
  assert.deepEqual(second.body?.references, []);
  assert(!("add" in second));
});

test("identity extraction accepts incomplete fields while full metadata validation reports them", () => {
  const input = {
    file: "intent.md",
    raw: "---\nid: change-000042/intent\nstatus: unknown\n---\n# Черновик\nTODO(VF)\n",
  };
  const identity = readDocumentIdentity(input);
  assert.equal(identity.value?.identity.id, "change-000042/intent");
  assert.deepEqual(identity.diagnostics, []);
  const metadata = parseDocumentMetadata(input);
  assert.equal(metadata.value?.identity.id, identity.value?.identity.id);
  assert.deepEqual(
    metadata.diagnostics.map((d) => d.code),
    ["E_DATE", "E_DATE", "E_ENUM"],
  );
  assert.deepEqual(readDocumentIdentity(input), identity);
  for (const raw of ["# Нет YAML", "---\nid: invalid\n---\n# Ошибка"]) {
    const result = readDocumentIdentity({ file: "invalid.md", raw });
    assert.equal(result.value, null);
    assert.equal(result.diagnostics.length, 1);
  }
});

test("YAML and Markdown references preserve BOM/CRLF source positions", () => {
  const lf = source(
    "change-000042/intent",
    intentBody + "\n[srs-000008/R-1]\n",
    "origin:\n  - srs-000007\n",
  );
  const input = { ...lf, raw: "\uFEFF" + lf.raw.replaceAll("\n", "\r\n") };
  const parsed = parse(input);
  assert.equal(
    parsed.metadata?.references[0].offset,
    input.raw.indexOf("srs-000007"),
  );
  assert.equal(
    parsed.body?.references[0].offset,
    input.raw.indexOf("[srs-000008/R-1]"),
  );
  const index = buildDocumentIndex([parsed]);
  const diagnostics = validateReferences([parsed], index.value);
  assert.equal(diagnostics.length, 2);
  const lines = input.raw.split("\n");
  for (const item of diagnostics) {
    assert.equal(item.code, "E_REFERENCE_TARGET");
    assert.match(
      lines[item.line - 1].slice(item.column - 1),
      /^(?:srs-000007|\[srs-000008\/R-1\])/,
    );
  }
});

test("indexing preserves duplicate diagnostics and checks empty bundles without document callbacks", () => {
  const first = parse(source("change-000042/intent", intentBody));
  const duplicate = { ...first, file: "duplicate.md" };
  const result = buildDocumentIndex([first, duplicate], ["change-000043"]);
  assert.equal(result.value.documents.get("change-000042/intent"), first);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.file, d.code]),
    [
      ["duplicate.md", "E_DUPLICATE_ID"],
      [first.file, "E_DUPLICATE_ID"],
    ],
  );
  const empty = validateBundles(result.value, "process/changes").filter(
    (d) => d.file === "process/changes/change-000043",
  );
  assert.equal(empty.length, 3);
  assert(
    empty.every(
      (d) => d.code === "E_STRUCTURE" && d.line === 1 && d.column === 1,
    ),
  );
});

test("cross-document checks use local IDs from parsed bodies without changing parsed data", () => {
  const origin = parse(
    source("change-000042/intent", intentBody + "\n[srs-000007/R-1]\n"),
  );
  const target = parse(
    source(
      "srs-000007",
      "# Требования\n\n## Purpose and Boundaries\nГраницы.\n\n## Requirements\n\n### R-1: Требование\nУсловие.\n",
    ),
  );
  const index = buildDocumentIndex([origin, target]);
  const before = structuredClone([origin, target]);
  assert.deepEqual(validateReferences([origin, target], index.value), []);
  assert.deepEqual([origin, target], before);
  const missing = validateReferences(
    [origin],
    buildDocumentIndex([origin]).value,
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "E_REFERENCE_TARGET");
  assert.deepEqual(validateReferences([origin, target], index.value), []);
});

test("project validation retains invalid-metadata documents and new only requires the identity index", async (t) => {
  const root = await project(t, false);
  const relative = "viaferrata/changes/change-000050/intent.md";
  const raw = "---\nid: change-000050/intent\n---\n# Черновик\nTODO(VF)\n";
  await write(root, relative, raw);
  const config = await loadConfig(root);
  const indexed = await indexProject(config);
  assert.deepEqual(indexed.diagnostics, []);
  assert.equal(indexed.documents.length, 1);
  assert(!("body" in indexed.documents[0]));
  const checked = await validateProject(config);
  assert(checked.diagnostics.some((d) => d.code === "E_DRAFT_PLACEHOLDER"));
  assert(checked.diagnostics.some((d) => d.code === "E_STRUCTURE"));
  assert.equal(
    (await createChange(config, "Следующая задача")).id,
    "change-000051",
  );

  await write(root, "viaferrata/specs/broken.md", "# Нет метаданных\n");
  const invalid = await validateProject(config);
  const document = invalid.documents.find(
    (d) => d.file === "viaferrata/specs/broken.md",
  );
  assert(document);
  assert.equal(document.raw, "# Нет метаданных\n");
  assert.equal(document.metadata, null);
  assert.equal(document.body, null);
  assert(
    invalid.diagnostics.some(
      (d) => d.file === document.file && d.code === "E_YAML",
    ),
  );
  assert(
    (await indexProject(config)).diagnostics.some((d) => d.code === "E_YAML"),
  );
});
