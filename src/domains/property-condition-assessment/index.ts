export {
  PROPERTY_CONDITIONS,
  PROPERTY_CONDITION_ASSESSMENT_TYPES,
  PROPERTY_CONDITION_OBSERVATION_STATUSES,
  PROPERTY_CONDITION_SECTIONS,
  PROPERTY_REPLACEMENT_PRIORITIES,
  PROPERTY_VALUATION_IMPACTS,
  createPropertyConditionAssessment,
} from "./property-condition-assessment.types";

export type {
  PropertyCondition,
  PropertyConditionAttributeValue,
  PropertyConditionAssessment,
  PropertyConditionAssessmentItem,
  PropertyConditionAssessmentType,
  PropertyConditionObservationStatus,
  PropertyConditionSection,
  PropertyReplacementPriority,
  PropertyValuationImpact,
} from "./property-condition-assessment.types";


export type {
  PropertyConditionAssessmentPersistenceContext,
  PropertyConditionAssessmentRepository,
} from "./property-condition-assessment.repository";

export {
  mapPropertyConditionAssessmentRecordToDomain,
  mapPropertyConditionAssessmentToRecord,
} from "./property-condition-assessment.mapper";

export type {
  PropertyConditionAssessmentItemRow,
  PropertyConditionAssessmentPersistenceRecord,
  PropertyConditionAssessmentRow,
} from "./property-condition-assessment.mapper";

export {
  InMemoryPropertyConditionAssessmentRepository,
} from "./in-memory-property-condition-assessment.repository";


export {
  SupabasePropertyConditionAssessmentRepository,
} from "./SupabasePropertyConditionAssessmentRepository.js";


export {
  PROPERTY_CONDITION_ATTRIBUTE_INPUT_TYPES,
  PROPERTY_CONDITION_CATALOG_SOURCE,
  PROPERTY_CONDITION_CHECKLIST_CATALOG,
  getPropertyConditionChecklistBySection,
  getPropertyConditionChecklistItem,
} from "./property-condition-assessment.catalog";

export type {
  PropertyConditionAttributeDefinition,
  PropertyConditionAttributeInputType,
  PropertyConditionChecklistItemDefinition,
} from "./property-condition-assessment.catalog";
