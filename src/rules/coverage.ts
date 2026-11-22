import type { RuleGroup } from "../diagnostics.ts";

export const coverageRules = {
  planRequirementCoverage: { id: "plan-requirement-coverage", code: "E_PLAN_COVERAGE" },
} as const satisfies RuleGroup;
