import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPropertyOperatingObligation,
  PROPERTY_OPERATING_OBLIGATION_RECOGNITION_STATUSES,
  PROPERTY_OPERATING_OBLIGATION_SCOPES,
  PROPERTY_OPERATING_OBLIGATION_STATUSES,
  PROPERTY_OPERATING_OBLIGATION_TYPES,
  PROPERTY_OPERATING_OBLIGATION_VERIFICATION_STATUSES,
} from "../property-operating-obligation.types";

function obligation(
  overrides = {},
) {
  return {
    id:
      "property_operating_obligation_1",
    scope: "property",
    propertyId:
      "1218-wagner",
    subjectLabel:
      "1218 Wagner",
    obligationType:
      "fire_insurance",
    annualAmountCents:
      41945,
    currencyCode: "usd",
    servicePeriodStart:
      "2026-03-19",
    servicePeriodEnd:
      "2027-03-19",
    paymentDate:
      "2026-02-25",
    paidAmountCents:
      42340,
    status: "active",
    verificationStatus:
      "document_verified",
    recognitionStatus:
      "accrual_ready",
    businessUseBasisPoints:
      null,
    source:
      "policy_document",
    providerName:
      "Texas Farm Bureau Underwriters",
    providerReference:
      "masked-policy-reference",
    evidenceId:
      "property_evidence_1",
    reconciledFinancialEventId:
      null,
    cancelledAt:
      null,
    createdAt:
      "2026-08-09T19:00:00.000Z",
    updatedAt:
      "2026-08-09T19:00:00.000Z",
    notes:
      "Windstorm, hurricane, and hail excluded.",
    ...overrides,
  };
}

describe(
  "PropertyOperatingObligation",
  () => {
    it(
      "defines the supported shared obligation vocabulary",
      () => {
        expect(
          PROPERTY_OPERATING_OBLIGATION_SCOPES,
        ).toEqual([
          "property",
          "portfolio",
          "personal_home_office",
        ]);

        expect(
          PROPERTY_OPERATING_OBLIGATION_TYPES,
        ).toContain(
          "property_tax",
        );

        expect(
          PROPERTY_OPERATING_OBLIGATION_TYPES,
        ).toContain(
          "flood_insurance",
        );

        expect(
          PROPERTY_OPERATING_OBLIGATION_STATUSES,
        ).toContain(
          "cancelled",
        );

        expect(
          PROPERTY_OPERATING_OBLIGATION_VERIFICATION_STATUSES,
        ).toContain(
          "document_verified",
        );

        expect(
          PROPERTY_OPERATING_OBLIGATION_RECOGNITION_STATUSES,
        ).toEqual([
          "pending",
          "accrual_ready",
          "cash_only",
        ]);
      },
    );

    it(
      "creates an immutable verified property obligation",
      () => {
        const created =
          createPropertyOperatingObligation(
            obligation(),
          );

        expect(created).toMatchObject({
          propertyId:
            "1218-wagner",
          annualAmountCents:
            41945,
          paidAmountCents:
            42340,
          currencyCode: "USD",
          status: "active",
          recognitionStatus:
            "accrual_ready",
        });

        expect(
          Object.isFrozen(created),
        ).toBe(true);
      },
    );

    it(
      "requires a property id for property scope",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              propertyId: null,
            }),
          ),
        ).toThrow(
          "Property-scoped operating obligations require a property id.",
        );
      },
    );

    it(
      "prevents non-property obligations from claiming a rental property",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              scope:
                "portfolio",
            }),
          ),
        ).toThrow(
          "Only property-scoped operating obligations may carry a property id.",
        );
      },
    );

    it(
      "requires complete dates before accrual recognition",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              servicePeriodEnd:
                null,
            }),
          ),
        ).toThrow(
          "Accrual-ready operating obligations require a complete service period.",
        );
      },
    );

    it(
      "requires service end after service start",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              servicePeriodEnd:
                "2026-03-18",
            }),
          ),
        ).toThrow(
          "Property operating obligation service period end must follow its start.",
        );
      },
    );

    it(
      "allows provisional records without service dates",
      () => {
        const created =
          createPropertyOperatingObligation(
            obligation({
              servicePeriodStart:
                null,
              servicePeriodEnd:
                null,
              recognitionStatus:
                "pending",
              verificationStatus:
                "owner_confirmed",
            }),
          );

        expect(
          created.servicePeriodStart,
        ).toBeNull();

        expect(
          created.recognitionStatus,
        ).toBe("pending");
      },
    );

    it(
      "requires a home-office allocation before accrual",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              scope:
                "personal_home_office",
              propertyId: null,
              subjectLabel:
                "4832 Share Lane",
              obligationType:
                "flood_insurance",
            }),
          ),
        ).toThrow(
          "Accrual-ready personal home-office obligations require a business-use allocation.",
        );
      },
    );

    it(
      "accepts a verified home-office allocation",
      () => {
        const created =
          createPropertyOperatingObligation(
            obligation({
              scope:
                "personal_home_office",
              propertyId: null,
              subjectLabel:
                "4832 Share Lane",
              obligationType:
                "flood_insurance",
              annualAmountCents:
                388000,
              businessUseBasisPoints:
                1250,
            }),
          );

        expect(
          created.businessUseBasisPoints,
        ).toBe(1250);
      },
    );

    it(
      "rejects invalid business-use percentages",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              businessUseBasisPoints:
                10001,
            }),
          ),
        ).toThrow(
          "Property operating obligation business use must be between 0 and 10000 basis points.",
        );
      },
    );

    it(
      "rejects unsupported obligation types",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              obligationType:
                "mortgage_principal",
            }),
          ),
        ).toThrow(
          "Property operating obligation requires a supported type.",
        );
      },
    );

    it(
      "rejects invalid monetary values",
      () => {
        expect(() =>
          createPropertyOperatingObligation(
            obligation({
              annualAmountCents:
                -1,
            }),
          ),
        ).toThrow(
          "Property operating obligation annual amount must be a non-negative integer number of cents.",
        );
      },
    );

    it(
      "normalizes optional references and notes",
      () => {
        const created =
          createPropertyOperatingObligation(
            obligation({
              providerReference:
                " ",
              evidenceId: "",
              notes:
                "  Owner confirmed active.  ",
            }),
          );

        expect(
          created.providerReference,
        ).toBeNull();

        expect(
          created.evidenceId,
        ).toBeNull();

        expect(
          created.notes,
        ).toBe(
          "Owner confirmed active.",
        );
      },
    );
  },
);
