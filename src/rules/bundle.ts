import type { RuleGroup } from "../diagnostics.ts";

export const bundleRules = {
  completeChange: { id: "complete-change", code: "E_STRUCTURE" },
  changeJournal: { id: "change-journal", code: "E_STRUCTURE" },
} as const satisfies RuleGroup;
