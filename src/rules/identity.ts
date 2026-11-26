import type { RuleGroup } from "../diagnostics.ts";

export const identityRules = {
  documentTreeEntries: { id: "document-tree-entries", code: "E_UNSUPPORTED" },
  documentId: { id: "document-id", code: "E_ID" },
  uniqueDocumentId: { id: "unique-document-id", code: "E_DUPLICATE_ID" },
  documentLocation: { id: "document-location", code: "E_LOCATION" },
  uniqueLocalId: { id: "unique-local-id", code: "E_DUPLICATE_ID" },
} as const satisfies RuleGroup;
