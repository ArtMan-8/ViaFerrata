import assert from "node:assert/strict";
import test from "node:test";

import { source, parse, intentBody } from "../tests/document-data.ts";
import { buildDocumentIndex } from "./index.ts";
import { validateReferences } from "./references.ts";

void test("YAML and Markdown references preserve BOM/CRLF source positions", () => {
  const lf = source(
    "change-000042/intent",
    intentBody + "\n[srs-000008/R-1]\n",
    "origin:\n  - srs-000007\n",
  );
  const input = { ...lf, raw: "\uFEFF" + lf.raw.replaceAll("\n", "\r\n") };
  const parsed = parse(input);
  assert.equal(parsed.metadata?.references[0].offset, input.raw.indexOf("srs-000007"));
  assert.equal(parsed.body?.references[0].offset, input.raw.indexOf("[srs-000008/R-1]"));
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

void test("cross-document checks use local IDs from parsed bodies without changing parsed data", () => {
  const origin = parse(source("change-000042/intent", intentBody + "\n[srs-000007/R-1]\n"));
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
  const missing = validateReferences([origin], buildDocumentIndex([origin]).value);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "E_REFERENCE_TARGET");
  assert.deepEqual(validateReferences([origin, target], index.value), []);
});
