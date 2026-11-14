import assert from "node:assert/strict";
import test from "node:test";

import { parseDocumentMetadata, readDocumentIdentity } from "./metadata.ts";

void test("identity extraction accepts incomplete fields while full metadata validation reports them", () => {
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
