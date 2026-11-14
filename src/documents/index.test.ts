import assert from "node:assert/strict";
import test from "node:test";

import { source, parse, intentBody } from "../tests/document-data.ts";
import { buildDocumentIndex, validateBundles } from "./index.ts";

void test("indexing preserves duplicate diagnostics and checks empty bundles without document callbacks", () => {
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
  assert(empty.every((d) => d.code === "E_STRUCTURE" && d.line === 1 && d.column === 1));
});
