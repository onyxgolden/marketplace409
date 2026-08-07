export const PROPERTY_VALUATION_TYPES = [
  "purchase_price",
  "owner_estimate",
  "appraisal",
  "assessed_value",
  "provider_estimate",
] as const;

export type PropertyValuationType =
  typeof PROPERTY_VALUATION_TYPES[number];

export const PROPERTY_VALUATION_SOURCES = [
  "manual",
  "spreadsheet",
  "county_records",
  "zillow",
  "other_provider",
] as const;

export type PropertyValuationSource =
  typeof PROPERTY_VALUATION_SOURCES[number];

export type PropertyValuation = Readonly<{
  id: string;
  propertyId: string;
  valuationType: PropertyValuationType;
  source: PropertyValuationSource;
  providerName: string | null;
  providerReference: string | null;
  amountCents: number;
  currencyCode: string;
  effectiveAt: string;
  createdAt: string;
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
      `Property valuation requires ${fieldName}.`,
    );
  }

  return value.trim();
}

function requireTimestamp(
  value: string,
  fieldName: string,
): string {
  const timestamp = requireNonEmptyString(
    value,
    fieldName,
  );

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(
      `Property valuation ${fieldName} must be a valid timestamp.`,
    );
  }

  return timestamp;
}

export function createPropertyValuation(
  valuation: PropertyValuation,
): PropertyValuation {
  const id = requireNonEmptyString(
    valuation.id,
    "an id",
  );
  const propertyId = requireNonEmptyString(
    valuation.propertyId,
    "a property id",
  );

  if (
    !PROPERTY_VALUATION_TYPES.includes(
      valuation.valuationType,
    )
  ) {
    throw new Error(
      "Property valuation requires a supported valuation type.",
    );
  }

  if (
    !PROPERTY_VALUATION_SOURCES.includes(
      valuation.source,
    )
  ) {
    throw new Error(
      "Property valuation requires a supported source.",
    );
  }

  if (
    !Number.isSafeInteger(valuation.amountCents) ||
    valuation.amountCents < 0
  ) {
    throw new Error(
      "Property valuation amount must be a non-negative integer number of cents.",
    );
  }

  const currencyCode = requireNonEmptyString(
    valuation.currencyCode,
    "a currency code",
  ).toUpperCase();

  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error(
      "Property valuation currency code must contain three letters.",
    );
  }

  return Object.freeze({
    ...valuation,
    id,
    propertyId,
    currencyCode,
    providerName:
      valuation.providerName?.trim() || null,
    providerReference:
      valuation.providerReference?.trim() || null,
    effectiveAt: requireTimestamp(
      valuation.effectiveAt,
      "effectiveAt",
    ),
    createdAt: requireTimestamp(
      valuation.createdAt,
      "createdAt",
    ),
    notes: valuation.notes?.trim() || null,
  });
}
