import type { RuleGroup } from "../diagnostics.ts";

export const referenceRules = {
  referenceList: { id: "reference-list", code: "E_REFERENCE_SYNTAX" },
  referenceListStyle: { id: "reference-list-style", code: "W_FORM" },
  referenceAddress: { id: "reference-address", code: "E_REFERENCE_SYNTAX" },
  referenceType: { id: "reference-type", code: "E_FIELD" },
  relationType: { id: "relation-type", code: "E_FIELD" },
  relationSelf: { id: "relation-self", code: "E_FIELD" },
  relationCycle: { id: "relation-cycle", code: "E_FIELD" },
  referenceTarget: { id: "reference-target", code: "E_REFERENCE_TARGET" },
  historicalRevision: { id: "historical-revision", code: "W_HISTORICAL_REVISION" },
  activeReferenceTarget: { id: "active-reference-target", code: "W_ARCHIVE_REFERENCE" },
} as const satisfies RuleGroup;
