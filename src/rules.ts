import { archiveRules } from "./rules/archive.ts";
import { bundleRules } from "./rules/bundle.ts";
import { configRules } from "./rules/config.ts";
import { coverageRules } from "./rules/coverage.ts";
import { deltaRules } from "./rules/delta.ts";
import { identityRules } from "./rules/identity.ts";
import { metadataRules } from "./rules/metadata.ts";
import { referenceRules } from "./rules/reference.ts";
import { structureRules } from "./rules/structure.ts";

export const coreRules = [
  configRules.validToml,
  configRules.knownConfigKeys,
  configRules.supportedProfile,
  configRules.validDocumentsRoot,
  configRules.validRequiredChecks,
  configRules.selectableCheck,
  identityRules.documentTreeEntries,
  identityRules.documentId,
  identityRules.uniqueDocumentId,
  identityRules.documentLocation,
  identityRules.uniqueLocalId,
  metadataRules.frontMatterDelimiters,
  metadataRules.validYaml,
  metadataRules.supportedYaml,
  metadataRules.metadataMapping,
  metadataRules.derivedIdentityFields,
  metadataRules.knownMetadataFields,
  metadataRules.calendarDate,
  metadataRules.chronologicalDates,
  metadataRules.stateFields,
  metadataRules.scopeDocumentType,
  metadataRules.supersedesDocumentType,
  metadataRules.scopeList,
  structureRules.documentTitle,
  structureRules.requiredSections,
  structureRules.localDeclarationLocation,
  structureRules.localHeading,
  structureRules.stepDeclaration,
  structureRules.stepWave,
  structureRules.filledDocument,
  structureRules.intentCriteria,
  structureRules.criterionVerification,
  structureRules.srsRequirements,
  structureRules.planWaves,
  structureRules.waveExecution,
  structureRules.waveSteps,
  bundleRules.completeChange,
  bundleRules.changeJournal,
  deltaRules.requirementDelta,
  referenceRules.referenceList,
  referenceRules.referenceListStyle,
  referenceRules.referenceAddress,
  referenceRules.referenceType,
  referenceRules.referenceTarget,
  referenceRules.historicalRevision,
  referenceRules.activeReferenceTarget,
  archiveRules.archiveChangeLocation,
  archiveRules.archiveChangeExecution,
  archiveRules.archiveDocumentState,
  archiveRules.pendingSynchronization,
] as const;

export const strictRules = [coverageRules.planRequirementCoverage] as const;

export type Rule = (typeof coreRules)[number] | (typeof strictRules)[number];

export type RuleId = Rule["id"];
