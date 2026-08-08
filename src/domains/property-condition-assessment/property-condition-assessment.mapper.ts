import {
  createPropertyConditionAssessment,
} from "./property-condition-assessment.types";

import type {
  PropertyCondition,
  PropertyConditionAssessment,
  PropertyConditionAssessmentType,
  PropertyConditionObservationStatus,
  PropertyConditionSection,
  PropertyReplacementPriority,
  PropertyValuationImpact,
} from "./property-condition-assessment.types";

export type PropertyConditionAssessmentRow =
  Readonly<{
    id: string;
    owner_id: string;
    property_id: string;
    assessment_type:
      PropertyConditionAssessmentType;
    effective_at: string;
    created_at: string;
    assessor_name: string | null;
    assessor_credential: string | null;
    source_reference: string | null;
    summary: string | null;
  }>;

export type PropertyConditionAssessmentItemRow =
  Readonly<{
    id: string;
    assessment_id: string;
    owner_id: string;
    section: PropertyConditionSection;
    system_key: string;
    item_key: string;
    label: string;
    observation_status:
      PropertyConditionObservationStatus;
    condition: PropertyCondition;
    replacement_priority:
      PropertyReplacementPriority;
    estimated_replacement_cost_cents:
      number | null;
    planned_replacement_year:
      number | null;
    valuation_impact:
      PropertyValuationImpact;
    notes: string | null;
  }>;

export type PropertyConditionAssessmentPersistenceRecord =
  Readonly<{
    assessment:
      PropertyConditionAssessmentRow;
    items:
      readonly PropertyConditionAssessmentItemRow[];
  }>;

function requireIdentifier(
  value: string,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

export function mapPropertyConditionAssessmentToRecord(
  assessment: PropertyConditionAssessment,
  ownerId: string,
): PropertyConditionAssessmentPersistenceRecord {
  const requiredOwnerId =
    requireIdentifier(
      ownerId,
      "Property condition assessment owner id is required.",
    );

  return Object.freeze({
    assessment: Object.freeze({
      id: assessment.id,
      owner_id: requiredOwnerId,
      property_id: assessment.propertyId,
      assessment_type:
        assessment.assessmentType,
      effective_at: assessment.effectiveAt,
      created_at: assessment.createdAt,
      assessor_name:
        assessment.assessorName,
      assessor_credential:
        assessment.assessorCredential,
      source_reference:
        assessment.sourceReference,
      summary: assessment.summary,
    }),
    items: Object.freeze(
      assessment.items.map(
        (item) =>
          Object.freeze({
            id: item.id,
            assessment_id:
              assessment.id,
            owner_id:
              requiredOwnerId,
            section: item.section,
            system_key:
              item.systemKey,
            item_key: item.itemKey,
            label: item.label,
            observation_status:
              item.observationStatus,
            condition: item.condition,
            replacement_priority:
              item.replacementPriority,
            estimated_replacement_cost_cents:
              item.estimatedReplacementCostCents,
            planned_replacement_year:
              item.plannedReplacementYear,
            valuation_impact:
              item.valuationImpact,
            notes: item.notes,
          }),
      ),
    ),
  });
}

export function mapPropertyConditionAssessmentRecordToDomain(
  record:
    PropertyConditionAssessmentPersistenceRecord,
): PropertyConditionAssessment {
  const assessmentId =
    requireIdentifier(
      record.assessment.id,
      "Property condition assessment row id is required.",
    );
  const ownerId =
    requireIdentifier(
      record.assessment.owner_id,
      "Property condition assessment owner id is required.",
    );

  for (const item of record.items) {
    if (
      item.assessment_id !== assessmentId
    ) {
      throw new Error(
        "Property condition assessment item references a different assessment.",
      );
    }

    if (item.owner_id !== ownerId) {
      throw new Error(
        "Property condition assessment item references a different owner.",
      );
    }
  }

  return createPropertyConditionAssessment({
    id: assessmentId,
    propertyId:
      record.assessment.property_id,
    assessmentType:
      record.assessment.assessment_type,
    effectiveAt:
      record.assessment.effective_at,
    createdAt:
      record.assessment.created_at,
    assessorName:
      record.assessment.assessor_name,
    assessorCredential:
      record.assessment.assessor_credential,
    sourceReference:
      record.assessment.source_reference,
    summary:
      record.assessment.summary,
    items:
      record.items.map((item) => ({
        id: item.id,
        section: item.section,
        systemKey: item.system_key,
        itemKey: item.item_key,
        label: item.label,
        observationStatus:
          item.observation_status,
        condition: item.condition,
        replacementPriority:
          item.replacement_priority,
        estimatedReplacementCostCents:
          item.estimated_replacement_cost_cents ===
          null
            ? null
            : Number(
                item.estimated_replacement_cost_cents,
              ),
        plannedReplacementYear:
          item.planned_replacement_year ===
          null
            ? null
            : Number(
                item.planned_replacement_year,
              ),
        valuationImpact:
          item.valuation_impact,
        notes: item.notes,
      })),
  });
}
