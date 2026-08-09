import {
  createPropertyOperatingObligation,
} from "./property-operating-obligation.types";

import type {
  PropertyOperatingObligation,
  PropertyOperatingObligationRecognitionStatus,
  PropertyOperatingObligationScope,
  PropertyOperatingObligationSource,
  PropertyOperatingObligationStatus,
  PropertyOperatingObligationType,
  PropertyOperatingObligationVerificationStatus,
} from "./property-operating-obligation.types";

export type PropertyOperatingObligationRow =
  Readonly<{
    id: string;
    owner_id: string;
    scope: PropertyOperatingObligationScope;
    property_id: string | null;
    subject_label: string;
    obligation_type:
      PropertyOperatingObligationType;
    annual_amount_cents: number;
    currency_code: string;
    service_period_start: string | null;
    service_period_end: string | null;
    payment_date: string | null;
    paid_amount_cents: number | null;
    status: PropertyOperatingObligationStatus;
    verification_status:
      PropertyOperatingObligationVerificationStatus;
    recognition_status:
      PropertyOperatingObligationRecognitionStatus;
    business_use_basis_points: number | null;
    source: PropertyOperatingObligationSource;
    provider_name: string | null;
    provider_reference: string | null;
    evidence_id: string | null;
    reconciled_financial_event_id:
      string | null;
    cancelled_at: string | null;
    created_at: string;
    updated_at: string;
    notes: string | null;
  }>;

function requireOwnerId(
  ownerId: string,
): string {
  if (
    typeof ownerId !== "string" ||
    ownerId.trim().length === 0
  ) {
    throw new Error(
      "Property operating obligation owner id is required.",
    );
  }

  return ownerId.trim();
}

export function mapPropertyOperatingObligationRowToDomain(
  row: PropertyOperatingObligationRow,
): PropertyOperatingObligation {
  return createPropertyOperatingObligation({
    id: row.id,
    scope: row.scope,
    propertyId: row.property_id,
    subjectLabel: row.subject_label,
    obligationType: row.obligation_type,
    annualAmountCents:
      Number(row.annual_amount_cents),
    currencyCode: row.currency_code,
    servicePeriodStart:
      row.service_period_start,
    servicePeriodEnd:
      row.service_period_end,
    paymentDate: row.payment_date,
    paidAmountCents:
      row.paid_amount_cents === null
        ? null
        : Number(row.paid_amount_cents),
    status: row.status,
    verificationStatus:
      row.verification_status,
    recognitionStatus:
      row.recognition_status,
    businessUseBasisPoints:
      row.business_use_basis_points === null
        ? null
        : Number(
            row.business_use_basis_points,
          ),
    source: row.source,
    providerName: row.provider_name,
    providerReference:
      row.provider_reference,
    evidenceId: row.evidence_id,
    reconciledFinancialEventId:
      row.reconciled_financial_event_id,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes,
  });
}

export function mapPropertyOperatingObligationToRow(
  obligation: PropertyOperatingObligation,
  ownerId: string,
): PropertyOperatingObligationRow {
  return Object.freeze({
    id: obligation.id,
    owner_id: requireOwnerId(ownerId),
    scope: obligation.scope,
    property_id: obligation.propertyId,
    subject_label: obligation.subjectLabel,
    obligation_type:
      obligation.obligationType,
    annual_amount_cents:
      obligation.annualAmountCents,
    currency_code: obligation.currencyCode,
    service_period_start:
      obligation.servicePeriodStart,
    service_period_end:
      obligation.servicePeriodEnd,
    payment_date: obligation.paymentDate,
    paid_amount_cents:
      obligation.paidAmountCents,
    status: obligation.status,
    verification_status:
      obligation.verificationStatus,
    recognition_status:
      obligation.recognitionStatus,
    business_use_basis_points:
      obligation.businessUseBasisPoints,
    source: obligation.source,
    provider_name: obligation.providerName,
    provider_reference:
      obligation.providerReference,
    evidence_id: obligation.evidenceId,
    reconciled_financial_event_id:
      obligation.reconciledFinancialEventId,
    cancelled_at: obligation.cancelledAt,
    created_at: obligation.createdAt,
    updated_at: obligation.updatedAt,
    notes: obligation.notes,
  });
}
