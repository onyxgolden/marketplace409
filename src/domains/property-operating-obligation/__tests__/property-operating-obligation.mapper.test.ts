import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapPropertyOperatingObligationRowToDomain,
  mapPropertyOperatingObligationToRow,
} from "../property-operating-obligation.mapper";

import {
  createPropertyOperatingObligation,
} from "../property-operating-obligation.types";

function obligation() {
  return createPropertyOperatingObligation({
    id: "obligation_1",
    scope: "property",
    propertyId: "1214-wagner",
    subjectLabel: "1214 Wagner taxes",
    obligationType: "property_tax",
    annualAmountCents: 186500,
    currencyCode: "USD",
    servicePeriodStart: "2025-01-01",
    servicePeriodEnd: "2026-01-01",
    paymentDate: "2026-01-06",
    paidAmountCents: 186500,
    status: "active",
    verificationStatus:
      "owner_confirmed",
    recognitionStatus:
      "accrual_ready",
    businessUseBasisPoints: null,
    source: "spreadsheet",
    providerName: "County Tax Office",
    providerReference: null,
    evidenceId: null,
    reconciledFinancialEventId:
      "financial_event_1",
    cancelledAt: null,
    createdAt:
      "2026-08-09T14:00:00.000Z",
    updatedAt:
      "2026-08-09T14:00:00.000Z",
    notes: "Annual 2025 taxes.",
  });
}

describe(
  "property operating obligation mapper",
  () => {
    it(
      "maps a domain obligation into an owner-scoped row",
      () => {
        expect(
          mapPropertyOperatingObligationToRow(
            obligation(),
            " owner_1 ",
          ),
        ).toEqual({
          id: "obligation_1",
          owner_id: "owner_1",
          scope: "property",
          property_id: "1214-wagner",
          subject_label:
            "1214 Wagner taxes",
          obligation_type:
            "property_tax",
          annual_amount_cents: 186500,
          currency_code: "USD",
          service_period_start:
            "2025-01-01",
          service_period_end:
            "2026-01-01",
          payment_date: "2026-01-06",
          paid_amount_cents: 186500,
          status: "active",
          verification_status:
            "owner_confirmed",
          recognition_status:
            "accrual_ready",
          business_use_basis_points:
            null,
          source: "spreadsheet",
          provider_name:
            "County Tax Office",
          provider_reference: null,
          evidence_id: null,
          reconciled_financial_event_id:
            "financial_event_1",
          cancelled_at: null,
          created_at:
            "2026-08-09T14:00:00.000Z",
          updated_at:
            "2026-08-09T14:00:00.000Z",
          notes:
            "Annual 2025 taxes.",
        });
      },
    );

    it(
      "maps a persistence row into an immutable domain obligation",
      () => {
        const mapped =
          mapPropertyOperatingObligationRowToDomain(
            mapPropertyOperatingObligationToRow(
              obligation(),
              "owner_1",
            ),
          );

        expect(mapped).toEqual(
          obligation(),
        );
        expect(
          Object.isFrozen(mapped),
        ).toBe(true);
      },
    );

    it(
      "requires owner authority before persistence mapping",
      () => {
        expect(() =>
          mapPropertyOperatingObligationToRow(
            obligation(),
            "",
          ),
        ).toThrow(
          "Property operating obligation owner id is required.",
        );
      },
    );
  },
);
