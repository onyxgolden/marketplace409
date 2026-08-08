export const PROPERTY_CONDITION_ASSESSMENT_TYPES = [
  "owner_assessment",
  "licensed_inspection",
  "contractor_evaluation",
  "maintenance_review",
] as const;

export type PropertyConditionAssessmentType =
  typeof PROPERTY_CONDITION_ASSESSMENT_TYPES[number];

export const PROPERTY_CONDITION_SECTIONS = [
  "structural_systems",
  "electrical_systems",
  "hvac_systems",
  "plumbing_systems",
  "appliances",
  "optional_systems",
] as const;

export type PropertyConditionSection =
  typeof PROPERTY_CONDITION_SECTIONS[number];

export const PROPERTY_CONDITION_OBSERVATION_STATUSES = [
  "observed",
  "not_observed",
  "not_present",
  "attention_needed",
  "unknown",
] as const;

export type PropertyConditionObservationStatus =
  typeof PROPERTY_CONDITION_OBSERVATION_STATUSES[number];

export const PROPERTY_CONDITIONS = [
  "good",
  "serviceable",
  "marginal",
  "poor",
  "failed",
  "unknown",
] as const;

export type PropertyCondition =
  typeof PROPERTY_CONDITIONS[number];

export const PROPERTY_REPLACEMENT_PRIORITIES = [
  "routine",
  "monitor",
  "planned",
  "urgent",
  "immediate",
  "unknown",
] as const;

export type PropertyReplacementPriority =
  typeof PROPERTY_REPLACEMENT_PRIORITIES[number];

export const PROPERTY_VALUATION_IMPACTS = [
  "positive",
  "none",
  "negative",
  "unknown",
] as const;

export type PropertyValuationImpact =
  typeof PROPERTY_VALUATION_IMPACTS[number];

export type PropertyConditionAttributeValue =
  string | number | boolean | null;

export type PropertyConditionAssessmentItem =
  Readonly<{
    id: string;
    section: PropertyConditionSection;
    systemKey: string;
    itemKey: string;
    label: string;
    observationStatus:
      PropertyConditionObservationStatus;
    condition: PropertyCondition;
    replacementPriority:
      PropertyReplacementPriority;
    estimatedReplacementCostCents:
      number | null;
    plannedReplacementYear:
      number | null;
    valuationImpact:
      PropertyValuationImpact;
    attributes:
      Readonly<
        Record<
          string,
          PropertyConditionAttributeValue
        >
      >;
    notes: string | null;
  }>;

export type PropertyConditionAssessment =
  Readonly<{
    id: string;
    propertyId: string;
    assessmentType:
      PropertyConditionAssessmentType;
    effectiveAt: string;
    createdAt: string;
    assessorName: string | null;
    assessorCredential: string | null;
    sourceReference: string | null;
    summary: string | null;
    items:
      readonly PropertyConditionAssessmentItem[];
  }>;

function requireNonEmptyString(
  value: string,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(
      `Property condition assessment requires ${fieldName}.`,
    );
  }

  return value.trim();
}

function normalizeOptionalString(
  value: string | null,
): string | null {
  return value?.trim() || null;
}

function requireTimestamp(
  value: string,
  fieldName: string,
): string {
  const timestamp =
    requireNonEmptyString(
      value,
      fieldName,
    );

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(
      `Property condition assessment ${fieldName} must be a valid timestamp.`,
    );
  }

  return timestamp;
}

function normalizeAttributes(
  value:
    | Readonly<
        Record<
          string,
          PropertyConditionAttributeValue
        >
      >
    | null
    | undefined,
): Readonly<
  Record<
    string,
    PropertyConditionAttributeValue
  >
> {
  if (value == null) {
    return Object.freeze({});
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Property condition assessment item attributes must be an object.",
    );
  }

  const normalized:
    Record<
      string,
      PropertyConditionAttributeValue
    > = {};

  for (
    const [
      rawKey,
      rawValue,
    ] of Object.entries(value)
  ) {
    const key = rawKey.trim();

    if (key === "") {
      throw new Error(
        "Property condition assessment item attribute keys must not be empty.",
      );
    }

    if (
      rawValue !== null &&
      typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "boolean"
    ) {
      throw new Error(
        "Property condition assessment item attribute values must be strings, numbers, booleans, or null.",
      );
    }

    if (
      typeof rawValue === "number" &&
      !Number.isFinite(rawValue)
    ) {
      throw new Error(
        "Property condition assessment item numeric attributes must be finite.",
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        normalized,
        key,
      )
    ) {
      throw new Error(
        "Property condition assessment item attribute keys must be unique after normalization.",
      );
    }

    normalized[key] =
      typeof rawValue === "string"
        ? rawValue.trim()
        : rawValue;
  }

  return Object.freeze(
    normalized,
  );
}

function createAssessmentItem(
  item: PropertyConditionAssessmentItem,
): PropertyConditionAssessmentItem {
  const id =
    requireNonEmptyString(
      item.id,
      "an item id",
    );

  if (
    !PROPERTY_CONDITION_SECTIONS.includes(
      item.section,
    )
  ) {
    throw new Error(
      "Property condition assessment item requires a supported section.",
    );
  }

  if (
    !PROPERTY_CONDITION_OBSERVATION_STATUSES.includes(
      item.observationStatus,
    )
  ) {
    throw new Error(
      "Property condition assessment item requires a supported observation status.",
    );
  }

  if (
    !PROPERTY_CONDITIONS.includes(
      item.condition,
    )
  ) {
    throw new Error(
      "Property condition assessment item requires a supported condition.",
    );
  }

  if (
    !PROPERTY_REPLACEMENT_PRIORITIES.includes(
      item.replacementPriority,
    )
  ) {
    throw new Error(
      "Property condition assessment item requires a supported replacement priority.",
    );
  }

  if (
    !PROPERTY_VALUATION_IMPACTS.includes(
      item.valuationImpact,
    )
  ) {
    throw new Error(
      "Property condition assessment item requires a supported valuation impact.",
    );
  }

  if (
    item.estimatedReplacementCostCents !== null &&
    (
      !Number.isSafeInteger(
        item.estimatedReplacementCostCents,
      ) ||
      item.estimatedReplacementCostCents < 0
    )
  ) {
    throw new Error(
      "Property condition assessment replacement cost must be a non-negative integer number of cents.",
    );
  }

  if (
    item.plannedReplacementYear !== null &&
    (
      !Number.isInteger(
        item.plannedReplacementYear,
      ) ||
      item.plannedReplacementYear < 1900 ||
      item.plannedReplacementYear > 2200
    )
  ) {
    throw new Error(
      "Property condition assessment planned replacement year must be between 1900 and 2200.",
    );
  }

  return Object.freeze({
    ...item,
    id,
    systemKey:
      requireNonEmptyString(
        item.systemKey,
        "an item system key",
      ),
    itemKey:
      requireNonEmptyString(
        item.itemKey,
        "an item key",
      ),
    label:
      requireNonEmptyString(
        item.label,
        "an item label",
      ),
    attributes:
      normalizeAttributes(
        item.attributes,
      ),
    notes:
      normalizeOptionalString(
        item.notes,
      ),
  });
}

export function createPropertyConditionAssessment(
  assessment: PropertyConditionAssessment,
): PropertyConditionAssessment {
  if (
    !PROPERTY_CONDITION_ASSESSMENT_TYPES.includes(
      assessment.assessmentType,
    )
  ) {
    throw new Error(
      "Property condition assessment requires a supported assessment type.",
    );
  }

  if (!Array.isArray(assessment.items)) {
    throw new Error(
      "Property condition assessment requires an items array.",
    );
  }

  const items =
    assessment.items.map(
      createAssessmentItem,
    );

  const itemIds =
    new Set(
      items.map((item) => item.id),
    );

  if (itemIds.size !== items.length) {
    throw new Error(
      "Property condition assessment item ids must be unique.",
    );
  }

  return Object.freeze({
    ...assessment,
    id:
      requireNonEmptyString(
        assessment.id,
        "an id",
      ),
    propertyId:
      requireNonEmptyString(
        assessment.propertyId,
        "a property id",
      ),
    effectiveAt:
      requireTimestamp(
        assessment.effectiveAt,
        "effectiveAt",
      ),
    createdAt:
      requireTimestamp(
        assessment.createdAt,
        "createdAt",
      ),
    assessorName:
      normalizeOptionalString(
        assessment.assessorName,
      ),
    assessorCredential:
      normalizeOptionalString(
        assessment.assessorCredential,
      ),
    sourceReference:
      normalizeOptionalString(
        assessment.sourceReference,
      ),
    summary:
      normalizeOptionalString(
        assessment.summary,
      ),
    items:
      Object.freeze(items),
  });
}
