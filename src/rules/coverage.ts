import type { RuleGroup } from "../diagnostics.ts";

export const coverageRules = {
  verificationCoverage: { id: "verification-coverage", code: "W_VERIFICATION_COVERAGE" },
  planRequirementCoverage: { id: "plan-requirement-coverage", code: "E_PLAN_COVERAGE" },
} as const satisfies RuleGroup;
