import type { RuleGroup } from "../diagnostics.ts";

export const referenceRules = {
  referenceList: { id: "reference-list", code: "E_REFERENCE_SYNTAX" },
  referenceListStyle: { id: "reference-list-style", code: "W_FORM" },
  referenceAddress: { id: "reference-address", code: "E_REFERENCE_SYNTAX" },
  referenceType: { id: "reference-type", code: "E_FIELD" },
  referenceTarget: { id: "reference-target", code: "E_REFERENCE_TARGET" },
  historicalRevision: { id: "historical-revision", code: "W_HISTORY" },
  activeReferenceTarget: { id: "active-reference-target", code: "W_ARCHIVE_REFERENCE" },
} as const satisfies RuleGroup;
