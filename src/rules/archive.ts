import type { RuleGroup } from "../diagnostics.ts";

export const archiveRules = {
  archiveChangeLocation: { id: "archive-change-location", code: "E_ARCHIVE_STATE" },
  archiveChangeExecution: { id: "archive-change-execution", code: "E_ARCHIVE_STATE" },
  archiveDocumentState: { id: "archive-document-state", code: "E_ARCHIVE_STATE" },
  pendingSynchronization: { id: "pending-synchronization", code: "W_SYNC_PENDING" },
} as const satisfies RuleGroup;
