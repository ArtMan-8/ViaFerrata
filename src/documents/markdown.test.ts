import assert from "node:assert/strict";
import test from "node:test";

import { source, parse, intentBody } from "../tests/document-data.ts";
import { parseDocumentBody } from "./markdown.ts";
import { parseDocumentMetadata } from "./metadata.ts";

void test("metadata and Markdown parsers preserve input and return independent results", () => {
  const input = source("change-000042/intent", intentBody + "\n[srs-000007/R-1]\n");
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
