export const PROPERTY_OPERATING_OBLIGATION_SCOPES = [
  "property",
  "portfolio",
  "personal_home_office",
] as const;

export type PropertyOperatingObligationScope =
  typeof PROPERTY_OPERATING_OBLIGATION_SCOPES[number];

export const PROPERTY_OPERATING_OBLIGATION_TYPES = [
  "property_tax",
  "fire_insurance",
  "windstorm_insurance",
  "flood_insurance",
  "bundled_fire_windstorm_insurance",
  "business_liability_insurance",
  "other_insurance",
] as const;

export type PropertyOperatingObligationType =
  typeof PROPERTY_OPERATING_OBLIGATION_TYPES[number];

export const PROPERTY_OPERATING_OBLIGATION_STATUSES = [
  "provisional",
  "active",
  "cancelled",
  "expired",
] as const;

export type PropertyOperatingObligationStatus =
  typeof PROPERTY_OPERATING_OBLIGATION_STATUSES[number];

export const PROPERTY_OPERATING_OBLIGATION_VERIFICATION_STATUSES = [
  "unverified",
  "owner_confirmed",
  "document_verified",
] as const;

export type PropertyOperatingObligationVerificationStatus =
  typeof PROPERTY_OPERATING_OBLIGATION_VERIFICATION_STATUSES[number];

export const PROPERTY_OPERATING_OBLIGATION_RECOGNITION_STATUSES = [
  "pending",
  "accrual_ready",
  "cash_only",
] as const;

export type PropertyOperatingObligationRecognitionStatus =
  typeof PROPERTY_OPERATING_OBLIGATION_RECOGNITION_STATUSES[number];

export const PROPERTY_OPERATING_OBLIGATION_SOURCES = [
  "manual",
  "spreadsheet",
  "county_records",
  "policy_document",
  "financial_event",
] as const;

export type PropertyOperatingObligationSource =
  typeof PROPERTY_OPERATING_OBLIGATION_SOURCES[number];

export type PropertyOperatingObligation = Readonly<{
  id: string;
  scope: PropertyOperatingObligationScope;
  propertyId: string | null;
  subjectLabel: string;
  obligationType: PropertyOperatingObligationType;
  annualAmountCents: number;
  currencyCode: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  paymentDate: string | null;
  paidAmountCents: number | null;
  status: PropertyOperatingObligationStatus;
  verificationStatus:
    PropertyOperatingObligationVerificationStatus;
  recognitionStatus:
    PropertyOperatingObligationRecognitionStatus;
  businessUseBasisPoints: number | null;
  source: PropertyOperatingObligationSource;
  providerName: string | null;
  providerReference: string | null;
  evidenceId: string | null;
  reconciledFinancialEventId: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
}>;

function requireNonEmptyString(
  value: string,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Property operating obligation requires ${fieldName}.`,
    );
  }

  return value.trim();
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}

function requireDateOnly(
  value: string,
  fieldName: string,
): string {
  const normalized =
    requireNonEmptyString(
      value,
      fieldName,
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalized,
    ) ||
    Number.isNaN(
      Date.parse(
        `${normalized}T00:00:00.000Z`,
      ),
    )
  ) {
    throw new Error(
      `Property operating obligation ${fieldName} must be a valid date.`,
    );
  }

  return normalized;
}

function normalizeOptionalDate(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const normalized =
    normalizeOptionalString(value);

  return normalized
    ? requireDateOnly(
        normalized,
        fieldName,
      )
    : null;
}

function requireTimestamp(
  value: string,
  fieldName: string,
): string {
  const normalized =
    requireNonEmptyString(
      value,
      fieldName,
    );

  if (
    Number.isNaN(
      Date.parse(normalized),
    )
  ) {
    throw new Error(
      `Property operating obligation ${fieldName} must be a valid timestamp.`,
    );
  }

  return normalized;
}

function requireMoneyCents(
  value: number,
  fieldName: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `Property operating obligation ${fieldName} must be a non-negative integer number of cents.`,
    );
  }

  return value;
}

export function createPropertyOperatingObligation(
  obligation:
    PropertyOperatingObligation,
): PropertyOperatingObligation {
  const id =
    requireNonEmptyString(
      obligation.id,
      "an id",
    );

  if (
    !PROPERTY_OPERATING_OBLIGATION_SCOPES
      .includes(
        obligation.scope,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported scope.",
    );
  }

  if (
    !PROPERTY_OPERATING_OBLIGATION_TYPES
      .includes(
        obligation.obligationType,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported type.",
    );
  }

  if (
    !PROPERTY_OPERATING_OBLIGATION_STATUSES
      .includes(
        obligation.status,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported status.",
    );
  }

  if (
    !PROPERTY_OPERATING_OBLIGATION_VERIFICATION_STATUSES
      .includes(
        obligation.verificationStatus,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported verification status.",
    );
  }

  if (
    !PROPERTY_OPERATING_OBLIGATION_RECOGNITION_STATUSES
      .includes(
        obligation.recognitionStatus,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported recognition status.",
    );
  }

  if (
    !PROPERTY_OPERATING_OBLIGATION_SOURCES
      .includes(
        obligation.source,
      )
  ) {
    throw new Error(
      "Property operating obligation requires a supported source.",
    );
  }

  const propertyId =
    normalizeOptionalString(
      obligation.propertyId,
    );

  if (
    obligation.scope ===
      "property" &&
    !propertyId
  ) {
    throw new Error(
      "Property-scoped operating obligations require a property id.",
    );
  }

  if (
    obligation.scope !==
      "property" &&
    propertyId
  ) {
    throw new Error(
      "Only property-scoped operating obligations may carry a property id.",
    );
  }

  const servicePeriodStart =
    normalizeOptionalDate(
      obligation.servicePeriodStart,
      "servicePeriodStart",
    );

  const servicePeriodEnd =
    normalizeOptionalDate(
      obligation.servicePeriodEnd,
      "servicePeriodEnd",
    );

  if (
    obligation.recognitionStatus ===
      "accrual_ready" &&
    (
      !servicePeriodStart ||
      !servicePeriodEnd
    )
  ) {
    throw new Error(
      "Accrual-ready operating obligations require a complete service period.",
    );
  }

  if (
    servicePeriodStart &&
    servicePeriodEnd &&
    servicePeriodEnd <=
      servicePeriodStart
  ) {
    throw new Error(
      "Property operating obligation service period end must follow its start.",
    );
  }

  const businessUseBasisPoints =
    obligation.businessUseBasisPoints;

  if (
    businessUseBasisPoints !== null &&
    (
      !Number.isSafeInteger(
        businessUseBasisPoints,
      ) ||
      businessUseBasisPoints < 0 ||
      businessUseBasisPoints > 10000
    )
  ) {
    throw new Error(
      "Property operating obligation business use must be between 0 and 10000 basis points.",
    );
  }

  if (
    obligation.scope ===
      "personal_home_office" &&
    obligation.recognitionStatus ===
      "accrual_ready" &&
    businessUseBasisPoints === null
  ) {
    throw new Error(
      "Accrual-ready personal home-office obligations require a business-use allocation.",
    );
  }

  const currencyCode =
    requireNonEmptyString(
      obligation.currencyCode,
      "a currency code",
    ).toUpperCase();

  if (
    !/^[A-Z]{3}$/.test(
      currencyCode,
    )
  ) {
    throw new Error(
      "Property operating obligation currency code must contain three letters.",
    );
  }

  return Object.freeze({
    ...obligation,
    id,
    scope:
      obligation.scope,
    propertyId,
    subjectLabel:
      requireNonEmptyString(
        obligation.subjectLabel,
        "a subject label",
      ),
    annualAmountCents:
      requireMoneyCents(
        obligation.annualAmountCents,
        "annual amount",
      ),
    currencyCode,
    servicePeriodStart,
    servicePeriodEnd,
    paymentDate:
      normalizeOptionalDate(
        obligation.paymentDate,
        "paymentDate",
      ),
    paidAmountCents:
      obligation.paidAmountCents ===
        null
        ? null
        : requireMoneyCents(
            obligation.paidAmountCents,
            "paid amount",
          ),
    businessUseBasisPoints,
    providerName:
      normalizeOptionalString(
        obligation.providerName,
      ),
    providerReference:
      normalizeOptionalString(
        obligation.providerReference,
      ),
    evidenceId:
      normalizeOptionalString(
        obligation.evidenceId,
      ),
    reconciledFinancialEventId:
      normalizeOptionalString(
        obligation.reconciledFinancialEventId,
      ),
    cancelledAt:
      normalizeOptionalDate(
        obligation.cancelledAt,
        "cancelledAt",
      ),
    createdAt:
      requireTimestamp(
        obligation.createdAt,
        "createdAt",
      ),
    updatedAt:
      requireTimestamp(
        obligation.updatedAt,
        "updatedAt",
      ),
    notes:
      normalizeOptionalString(
        obligation.notes,
      ),
  });
}
