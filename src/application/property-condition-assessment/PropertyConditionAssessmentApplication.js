import {
  createPropertyConditionAssessment,
} from "@/domains/property-condition-assessment/property-condition-assessment.types";

function readField(
  value,
  ...names
) {
  for (const name of names) {
    const field =
      value?.[name];

    if (
      field !== undefined &&
      field !== null &&
      String(field).trim() !== ""
    ) {
      return field;
    }
  }

  return null;
}

function requireIdentifier(
  value,
  message,
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function normalizeTimestamp(
  value,
  fallback,
  message,
) {
  const timestamp =
    value == null ||
    String(value).trim() === ""
      ? fallback
      : String(value).trim();

  if (
    Number.isNaN(
      Date.parse(timestamp),
    )
  ) {
    throw new Error(message);
  }

  return new Date(
    timestamp,
  ).toISOString();
}

function normalizeOptionalString(
  value,
) {
  return value == null
    ? null
    : String(value).trim() || null;
}

function dollarsToCents(value) {
  const normalized =
    typeof value === "string"
      ? value.replace(
          /[$,\s]/g,
          "",
        )
      : value;

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "Property condition assessment replacement cost must be a nonnegative number.",
    );
  }

  const cents =
    Math.round(amount * 100);

  if (
    !Number.isSafeInteger(cents)
  ) {
    throw new Error(
      "Property condition assessment replacement cost exceeds the supported range.",
    );
  }

  return cents;
}

function normalizeCost(item) {
  const cents =
    readField(
      item,
      "estimatedReplacementCostCents",
      "estimated_replacement_cost_cents",
    );

  if (cents !== null) {
    const amount =
      Number(cents);

    if (
      !Number.isSafeInteger(amount) ||
      amount < 0
    ) {
      throw new Error(
        "Property condition assessment replacement cost cents must be a nonnegative integer.",
      );
    }

    return amount;
  }

  const dollars =
    readField(
      item,
      "estimatedReplacementCost",
      "estimatedReplacementCostDollars",
      "estimated_replacement_cost",
    );

  return dollars === null
    ? null
    : dollarsToCents(dollars);
}

function freezeArray(values) {
  return Object.freeze([
    ...values,
  ]);
}

export class PropertyConditionAssessmentApplication {
  constructor(
    repository,
    options = {},
  ) {
    if (!repository) {
      throw new Error(
        "PropertyConditionAssessmentApplication requires a repository.",
      );
    }

    this.repository =
      repository;

    this.clock =
      options.clock ??
      (() =>
        new Date().toISOString());

    this.idFactory =
      options.idFactory ??
      (() =>
        crypto.randomUUID());
  }

  createOwnerAssessment(input) {
    const createdAt =
      normalizeTimestamp(
        this.clock(),
        new Date().toISOString(),
        "Property condition assessment creation date must be valid.",
      );

    const propertyId =
      readField(
        input,
        "propertyId",
        "property_id",
      );

    if (!propertyId) {
      throw new Error(
        "Property condition assessment property ID is required.",
      );
    }

    const items =
      input?.items;

    if (!Array.isArray(items)) {
      throw new Error(
        "Property condition assessment items are required.",
      );
    }

    return createPropertyConditionAssessment({
      id:
        input.id ??
        `property_condition_assessment_${this.idFactory()}`,
      propertyId:
        String(propertyId).trim(),
      assessmentType:
        "owner_assessment",
      effectiveAt:
        normalizeTimestamp(
          readField(
            input,
            "effectiveAt",
            "effective_at",
            "assessmentDate",
            "assessment_date",
          ),
          createdAt,
          "Property condition assessment effective date must be valid.",
        ),
      createdAt,
      assessorName:
        normalizeOptionalString(
          readField(
            input,
            "assessorName",
            "assessor_name",
          ),
        ),
      assessorCredential:
        null,
      sourceReference:
        normalizeOptionalString(
          readField(
            input,
            "sourceReference",
            "source_reference",
          ),
        ),
      summary:
        normalizeOptionalString(
          readField(
            input,
            "summary",
          ),
        ),
      items:
        items.map(
          (item) => ({
            id:
              item.id ??
              `property_condition_item_${this.idFactory()}`,
            section:
              String(
                readField(
                  item,
                  "section",
                ) ?? "",
              ).trim(),
            systemKey:
              String(
                readField(
                  item,
                  "systemKey",
                  "system_key",
                ) ?? "",
              ).trim(),
            itemKey:
              String(
                readField(
                  item,
                  "itemKey",
                  "item_key",
                ) ?? "",
              ).trim(),
            label:
              String(
                readField(
                  item,
                  "label",
                ) ?? "",
              ).trim(),
            observationStatus:
              String(
                readField(
                  item,
                  "observationStatus",
                  "observation_status",
                ) ??
                "unknown",
              ).trim(),
            condition:
              String(
                readField(
                  item,
                  "condition",
                ) ??
                "unknown",
              ).trim(),
            replacementPriority:
              String(
                readField(
                  item,
                  "replacementPriority",
                  "replacement_priority",
                ) ??
                "unknown",
              ).trim(),
            estimatedReplacementCostCents:
              normalizeCost(item),
            plannedReplacementYear:
              readField(
                item,
                "plannedReplacementYear",
                "planned_replacement_year",
              ) === null
                ? null
                : Number(
                    readField(
                      item,
                      "plannedReplacementYear",
                      "planned_replacement_year",
                    ),
                  ),
            valuationImpact:
              String(
                readField(
                  item,
                  "valuationImpact",
                  "valuation_impact",
                ) ??
                "unknown",
              ).trim(),
            notes:
              normalizeOptionalString(
                readField(
                  item,
                  "notes",
                ),
              ),
          }),
        ),
    });
  }

  async recordOwnerAssessment(
    input,
    ownerId,
  ) {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property condition assessment owner ID is required.",
      );

    const assessment =
      this.createOwnerAssessment(
        input,
      );

    return this.repository.save(
      assessment,
      {
        ownerId:
          requiredOwnerId,
      },
    );
  }

  async getById(
    assessmentId,
    ownerId,
  ) {
    return this.repository.findById(
      requireIdentifier(
        assessmentId,
        "Property condition assessment ID is required.",
      ),
      requireIdentifier(
        ownerId,
        "Property condition assessment owner ID is required.",
      ),
    );
  }

  async listByProperty(
    propertyId,
    ownerId,
  ) {
    const assessments =
      await this.repository.findByProperty(
        requireIdentifier(
          propertyId,
          "Property condition assessment property ID is required.",
        ),
        requireIdentifier(
          ownerId,
          "Property condition assessment owner ID is required.",
        ),
      );

    return freezeArray(
      assessments,
    );
  }

  async listLatest(ownerId) {
    const assessments =
      await this.repository.findLatestByOwnerId(
        requireIdentifier(
          ownerId,
          "Property condition assessment owner ID is required.",
        ),
      );

    return freezeArray(
      assessments,
    );
  }
}
