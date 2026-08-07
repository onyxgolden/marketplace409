import {
  createPropertyValuation,
} from "./property-valuation.types";

import type {
  PropertyValuation,
  PropertyValuationSource,
  PropertyValuationType,
} from "./property-valuation.types";

export type PropertyValuationRow = Readonly<{
  id: string;
  owner_id: string;
  property_id: string;
  valuation_type: PropertyValuationType;
  source: PropertyValuationSource;
  provider_name: string | null;
  provider_reference: string | null;
  amount_cents: number;
  currency_code: string;
  effective_at: string;
  created_at: string;
  notes: string | null;
}>;

export function mapPropertyValuationRowToPropertyValuation(
  row: PropertyValuationRow,
): PropertyValuation {
  return createPropertyValuation({
    id: row.id,
    propertyId: row.property_id,
    valuationType: row.valuation_type,
    source: row.source,
    providerName: row.provider_name,
    providerReference: row.provider_reference,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    effectiveAt: row.effective_at,
    createdAt: row.created_at,
    notes: row.notes,
  });
}

export function mapPropertyValuationToRow(
  valuation: PropertyValuation,
  ownerId: string,
): PropertyValuationRow {
  if (
    typeof ownerId !== "string" ||
    ownerId.trim().length === 0
  ) {
    throw new Error(
      "Property valuation owner id is required.",
    );
  }

  return Object.freeze({
    id: valuation.id,
    owner_id: ownerId.trim(),
    property_id: valuation.propertyId,
    valuation_type: valuation.valuationType,
    source: valuation.source,
    provider_name: valuation.providerName,
    provider_reference:
      valuation.providerReference,
    amount_cents: valuation.amountCents,
    currency_code: valuation.currencyCode,
    effective_at: valuation.effectiveAt,
    created_at: valuation.createdAt,
    notes: valuation.notes,
  });
}
