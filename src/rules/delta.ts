import type { RuleGroup } from "../diagnostics.ts";

export const deltaRules = {
  requirementDelta: { id: "requirement-delta", code: "W_FORM" },
} as const satisfies RuleGroup;
