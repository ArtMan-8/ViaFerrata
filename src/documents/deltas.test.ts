import assert from "node:assert/strict";
import test from "node:test";

import { source } from "../tests/document-data.ts";
import { parseDeltas } from "./deltas.ts";
import { parseDocumentBody } from "./markdown.ts";
import { parseDocumentMetadata } from "./metadata.ts";

function parsed(body: string) {
  const input = source(
    "change-000001/spec",
    `# Дельта\n\n## Requirements\n\n### R-1: Изменить формат\n\n${body}\n\n## Definition of Done\nПроверить.`,
  );
  const metadata = parseDocumentMetadata(input).value!;
  return { input, metadata, result: parseDeltas(input, metadata.bodyOffset) };
}
const fields =
  "- Operation: modify\n- Changes:\n  - [srs-000001/R-1]\n- Before: CSV с запятой.\n- After: CSV с точкой с запятой.\n\n  Заголовок обязателен.\n";
void test("delta keeps normative Before/After and exact reference offset", () => {
  const { result, input, metadata } = parsed(fields);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].before, "CSV с запятой.");
  assert.equal(result.value[0].after, "CSV с точкой с запятой.\n\n  Заголовок обязателен.");
  const body = parseDocumentBody(input, metadata);
  assert.equal(result.value[0].offset, body.value.references[0].offset);
});
void test("examples and nested fields cannot grant a planned target exception", () => {
  for (const example of [
    `\`\`\`markdown\n${fields}\`\`\``,
    fields
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    `<!--\n${fields}-->`,
    `- Example:\n${fields
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}`,
  ]) {
    assert.equal(parsed(example).result.value.length, 0);
  }
});
void test("missing, duplicate, wrong-type and contradictory delta fields are form warnings", () => {
  for (const body of [
    fields.replace("modify", "retire"),
    fields.replace("- Before:", "- Old:"),
    fields + "\n- Operation: modify\n",
    fields.replace("srs-000001/R-1", "change-000001/spec/R-1"),
    fields.replace("modify", "add"),
    fields.replace("modify", "remove"),
  ]) {
    const { result } = parsed(body);
    assert.equal(result.value.length, 0);
    assert.equal(result.diagnostics[0].code, "W_FORM");
  }
});
