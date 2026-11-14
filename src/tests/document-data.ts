import assert from "node:assert/strict";

import { parseDocumentBody } from "../documents/markdown.ts";
import { parseDocumentMetadata } from "../documents/metadata.ts";
import type { DocumentSource, ParsedDocument } from "../documents/types.ts";

export function source(id: string, body: string, extra = ""): DocumentSource {
  return Object.freeze({
    file: `${id}.md`,
    raw: `---\nid: ${id}\nstatus: draft\ncreated: "2026-11-13"\nupdated: "2026-11-13"\n${extra}---\n${body}`,
  });
}

export function parse(input: DocumentSource): ParsedDocument {
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

export const intentBody =
  "# Задача\n\n## Goal\nЦель.\n\n## Constraints\nОграничения.\n\n## Context\nКонтекст.\n\n## Acceptance Criteria\n\n### AC-1: Условие\n\n- Verification: Проверить.\n";
