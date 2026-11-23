import type { RuleGroup } from "../diagnostics.ts";

export const configRules = {
  validToml: { id: "valid-toml", code: "E_CONFIG" },
  knownConfigKeys: { id: "known-config-keys", code: "E_CONFIG" },
  supportedProfile: { id: "supported-profile", code: "E_CONFIG" },
  validDocumentsRoot: { id: "valid-documents-root", code: "E_CONFIG" },
  validRequiredChecks: { id: "valid-required-checks", code: "E_CONFIG" },
  selectableCheck: { id: "selectable-check", code: "E_CONFIG" },
} as const satisfies RuleGroup;
