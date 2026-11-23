import assert from "node:assert/strict";
import test from "node:test";

import { source } from "../tests/document-data.ts";
import { parseDocumentBody } from "./markdown.ts";
import { parseDocumentMetadata } from "./metadata.ts";

function parsed(body: string) {
  const input = source(
    "change-000001/spec",
    `# Дельта\n\n## Requirements\n\n### R-1: Изменить формат\n\n${body}\n\n## Definition of Done\nПроверить.`,
  );
  const metadata = parseDocumentMetadata(input).value!;
  const { value, diagnostics } = parseDocumentBody(input, metadata);
  return {
    input,
    metadata,
    result: {
      value: value.deltas ?? [],
      references: value.references,
      diagnostics: diagnostics.filter((item) => item.ruleId === "requirement-delta"),
    },
  };
}
const fields = [
  "```yaml",
  "operation: modify",
  "changes: srs-000001/R-1",
  "before: CSV с запятой.",
  "after: |-",
  "  CSV с точкой с запятой.",
  "",
  "    Заголовок обязателен.",
  "```",
].join("\n");
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
    fields.replace("before:", "old:"),
    fields.replace("operation: modify", "operation: modify\noperation: modify"),
    fields.replace("srs-000001/R-1", "change-000001/spec/R-1"),
    fields.replace("modify", "add"),
    fields.replace("modify", "remove"),
  ]) {
    const { result } = parsed(body);
    assert.equal(result.value.length, 0);
    assert.equal(result.diagnostics[0].code, "W_FORM");
  }
});

void test("sections, duplicate blocks, old fields and diagnostics are scoped to the requirement", () => {
  const other = "\n\n### R-2: Другой R\n\n";
  const { result } = parsed(
    fields + other + fields + "\n\n## Examples\n\n### R-3: Пример\n\n" + fields,
  );
  assert.deepEqual(
    result.value.map((delta) => delta.local),
    ["R-1", "R-2"],
  );
  const twice = parsed(fields + "\n\n" + fields);
  assert.deepEqual(twice.result.value, []);
  assert.equal(twice.result.references.length, 2);
  assert.match(parsed("- Operation: modify").result.diagnostics[0].message, /yaml/);
  assert.match(
    parsed(fields.replace("after: |-", "afetr: |-")).result.diagnostics[0].message,
    /afetr/,
  );
  assert.match(parsed(fields.slice(0, -3)).result.diagnostics[0].message, /Закройте/);
  for (const [body, token] of [
    [fields.replace("operation: modify", "operation: modify\noperation: modify"), "operation:"],
    [fields.replace("srs-000001/R-1", "srs-000001/AC-1"), "srs-000001/AC-1"],
  ]) {
    const { result: invalid, input } = parsed(body);
    const offset = input.raw.lastIndexOf(token);
    const d = invalid.diagnostics[0];
    assert.equal(d.line, input.raw.slice(0, offset).split("\n").length);
    assert.equal(d.column, offset - input.raw.lastIndexOf("\n", offset));
    assert.equal(d.ruleId, "requirement-delta");
  }
});

void test("revision references follow decoded Markdown eligibility and point inside each scalar", () => {
  const text = fields
    .replace("CSV с запятой.", "'`[srs-000001/R-2]` и [srs-000001/R-2]'")
    .replace("Заголовок обязателен.", "\\[srs-000001/R-3] и [srs-000001/R-4]");
  const { result, input } = parsed(text);
  assert.deepEqual(
    result.references.map((r) => r.value),
    ["srs-000001/R-1", "srs-000001/R-2", "srs-000001/R-4"],
  );
  for (const ref of result.references.slice(1)) {
    assert.equal(ref.offset, input.raw.lastIndexOf("[" + ref.value + "]"));
  }
});

void test("indented fences strip up to their opening indent and retain document offsets", () => {
  const block = [
    "  ~~~yaml",
    " operation: modify",
    "  changes: srs-000001/R-1",
    "before: old",
    "  after: |-",
    "    line",
    "    [srs-000001/R-2]",
    " ~~~",
  ].join("\r\n");
  const { result, input } = parsed(block);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.value[0].after, "line\n[srs-000001/R-2]");
  assert.equal(result.references[1].offset, input.raw.indexOf("[srs-000001/R-2]"));
});
