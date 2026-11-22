import type { RuleGroup } from "../diagnostics.ts";

export const metadataRules = {
  frontMatterDelimiters: { id: "front-matter-delimiters", code: "E_YAML" },
  validYaml: { id: "valid-yaml", code: "E_YAML" },
  supportedYaml: { id: "supported-yaml", code: "E_UNSUPPORTED" },
  metadataMapping: { id: "metadata-mapping", code: "E_YAML" },
  derivedIdentityFields: { id: "derived-identity-fields", code: "W_FORM" },
  knownMetadataFields: { id: "known-metadata-fields", code: "W_FORM" },
  calendarDate: { id: "calendar-date", code: "W_FORM" },
  chronologicalDates: { id: "chronological-dates", code: "W_FORM" },
  stateFields: { id: "state-fields", code: "W_FORM" },
  scopeDocumentType: { id: "scope-document-type", code: "W_FORM" },
  supersedesDocumentType: { id: "supersedes-document-type", code: "E_UNSUPPORTED" },
  scopeList: { id: "scope-list", code: "W_FORM" },
} as const satisfies RuleGroup;
