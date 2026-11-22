import type { RuleGroup } from "../diagnostics.ts";

export const structureRules = {
  documentTitle: { id: "document-title", code: "W_FORM" },
  requiredSections: { id: "required-sections", code: "W_FORM" },
  localDeclarationLocation: { id: "local-declaration-location", code: "W_FORM" },
  localHeading: { id: "local-heading", code: "W_FORM" },
  stepDeclaration: { id: "step-declaration", code: "W_FORM" },
  stepWave: { id: "step-wave", code: "W_FORM" },
  filledDocument: { id: "filled-document", code: "E_DRAFT_PLACEHOLDER" },
  intentCriteria: { id: "intent-criteria", code: "W_FORM" },
  criterionVerification: { id: "criterion-verification", code: "W_FORM" },
  srsRequirements: { id: "srs-requirements", code: "W_FORM" },
  planWaves: { id: "plan-waves", code: "W_FORM" },
  waveExecution: { id: "wave-execution", code: "W_FORM" },
  waveSteps: { id: "wave-steps", code: "W_FORM" },
} as const satisfies RuleGroup;
