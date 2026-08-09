import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PropertyOperatingObligationApplication,
  buildPropertyOperatingObligationAccrualProjection,
  calculateObligationAccrual,
} from "../PropertyOperatingObligationApplication.js";

import {
  InMemoryPropertyOperatingObligationRepository,
} from "@/domains/property-operating-obligation/in-memory-property-operating-obligation.repository";

import {
  createPropertyOperatingObligation,
} from "@/domains/property-operating-obligation/property-operating-obligation.types";

function obligation(overrides = {}) {
  return createPropertyOperatingObligation({
    id: "obligation_1",
    scope: "property",
    propertyId: "1214-wagner",
    subjectLabel:
      "1214 Wagner annual taxes",
    obligationType: "property_tax",
    annualAmountCents: 120000,
    currencyCode: "USD",
    servicePeriodStart:
      "2025-01-01",
    servicePeriodEnd:
      "2026-01-01",
    paymentDate: "2026-01-06",
    paidAmountCents: 120000,
    status: "active",
    verificationStatus:
      "owner_confirmed",
    recognitionStatus:
      "accrual_ready",
    businessUseBasisPoints: null,
    source: "spreadsheet",
    providerName: null,
    providerReference: null,
    evidenceId: null,
    reconciledFinancialEventId:
      null,
    cancelledAt: null,
    createdAt:
      "2026-08-09T14:00:00.000Z",
    updatedAt:
      "2026-08-09T14:00:00.000Z",
    notes: null,
    ...overrides,
  });
}

describe(
  "PropertyOperatingObligationApplication",
  () => {
    it(
      "accrues a complete annual obligation exactly",
      () => {
        expect(
          calculateObligationAccrual({
            obligation:
              obligation(),
            periodStart:
              "2025-01-01",
            periodEnd:
              "2026-01-01",
          }),
        ).toBe(120000);
      },
    );

    it(
      "allocates partial months without cumulative rounding drift",
      () => {
        const january =
          calculateObligationAccrual({
            obligation:
              obligation(),
            periodStart:
              "2025-01-01",
            periodEnd:
              "2025-02-01",
          });
        const remainder =
          calculateObligationAccrual({
            obligation:
              obligation(),
            periodStart:
              "2025-02-01",
            periodEnd:
              "2026-01-01",
          });

        expect(january).toBe(
          10191,
        );
        expect(
          january + remainder,
        ).toBe(120000);
      },
    );

    it(
      "returns zero outside the service period",
      () => {
        expect(
          calculateObligationAccrual({
            obligation:
              obligation(),
            periodStart:
              "2026-01-01",
            periodEnd:
              "2026-02-01",
          }),
        ).toBe(0);
      },
    );

    it(
      "does not accrue provisional or cash-only obligations",
      () => {
        expect(
          calculateObligationAccrual({
            obligation:
              obligation({
                recognitionStatus:
                  "cash_only",
                servicePeriodStart:
                  null,
                servicePeriodEnd:
                  null,
              }),
            periodStart:
              "2025-01-01",
            periodEnd:
              "2026-01-01",
          }),
        ).toBe(0);

        expect(
          calculateObligationAccrual({
            obligation:
              obligation({
                status:
                  "provisional",
              }),
            periodStart:
              "2025-01-01",
            periodEnd:
              "2026-01-01",
          }),
        ).toBe(0);
      },
    );

    it(
      "applies documented home-office allocation without treating it as rental NOI",
      () => {
        const homeOffice =
          obligation({
            id:
              "share-lane-flood",
            scope:
              "personal_home_office",
            propertyId: null,
            subjectLabel:
              "4832 Share Lane flood",
            obligationType:
              "flood_insurance",
            annualAmountCents:
              388000,
            servicePeriodStart:
              "2026-01-31",
            servicePeriodEnd:
              "2027-01-31",
            businessUseBasisPoints:
              2500,
          });

        const projection =
          buildPropertyOperatingObligationAccrualProjection({
            obligations: [
              homeOffice,
            ],
            periodStart:
              "2026-01-31",
            periodEnd:
              "2027-01-31",
          });

        expect(
          projection
            .scopeExpenseCents
            .personal_home_office,
        ).toBe(97000);
        expect(
          projection
            .propertyExpenseCents,
        ).toEqual({});
        expect(
          projection.entries[0]
            .treatment,
        ).toBe(
          "home_office_business_expense",
        );
      },
    );

    it(
      "separates property and portfolio operating expenses",
      () => {
        const projection =
          buildPropertyOperatingObligationAccrualProjection({
            obligations: [
              obligation(),
              obligation({
                id:
                  "business-liability",
                scope:
                  "portfolio",
                propertyId: null,
                subjectLabel:
                  "Business liability",
                obligationType:
                  "business_liability_insurance",
                annualAmountCents:
                  47400,
              }),
            ],
            periodStart:
              "2025-01-01",
            periodEnd:
              "2026-01-01",
          });

        expect(
          projection
            .propertyExpenseCents,
        ).toEqual({
          "1214-wagner":
            120000,
        });
        expect(
          projection
            .scopeExpenseCents,
        ).toEqual({
          portfolio: 47400,
          property: 120000,
        });
      },
    );

    it(
      "identifies reconciled cash events that must be removed from NOI",
      () => {
        const projection =
          buildPropertyOperatingObligationAccrualProjection({
            obligations: [
              obligation({
                reconciledFinancialEventId:
                  "financial_event_tax",
              }),
              obligation({
                id: "cash-only",
                recognitionStatus:
                  "cash_only",
                servicePeriodStart:
                  null,
                servicePeriodEnd:
                  null,
                reconciledFinancialEventId:
                  "cash_only_event",
              }),
            ],
            periodStart:
              "2025-01-01",
            periodEnd:
              "2026-01-01",
          });

        expect(
          projection
            .suppressedFinancialEventIds,
        ).toEqual([
          "financial_event_tax",
        ]);
      },
    );

    it(
      "rejects invalid reporting periods",
      () => {
        expect(() =>
          buildPropertyOperatingObligationAccrualProjection({
            obligations: [],
            periodStart:
              "2026-02-01",
            periodEnd:
              "2026-01-01",
          }),
        ).toThrow(
          "Accrual period end must follow its start.",
        );
      },
    );

    it(
      "saves through authenticated owner authority",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const application =
          new PropertyOperatingObligationApplication({
            repository,
          });

        await application.save(
          obligation(),
          "owner_1",
        );

        await expect(
          application.list(
            {},
            "owner_1",
          ),
        ).resolves.toEqual([
          obligation(),
        ]);
      },
    );

    it(
      "verifies policy coverage without changing imported payment facts",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const clock = vi.fn(() =>
          "2026-08-09T17:00:00.000Z"
        );
        const application =
          new PropertyOperatingObligationApplication({
            repository,
            clock,
          });

        const pending =
          obligation({
            obligationType:
              "bundled_fire_windstorm_insurance",
            servicePeriodStart:
              null,
            servicePeriodEnd:
              null,
            status:
              "provisional",
            verificationStatus:
              "unverified",
            recognitionStatus:
              "pending",
            annualAmountCents:
              42340,
            paidAmountCents:
              42340,
            paymentDate:
              "2026-03-19",
            reconciledFinancialEventId:
              "financial_event_insurance",
          });

        await application.save(
          pending,
          "owner_1",
        );

        const verified =
          await application
            .verifyCoverage({
              obligationId:
                "obligation_1",
              servicePeriodStart:
                "2026-03-19",
              servicePeriodEnd:
                "2027-03-19",
              annualAmountCents:
                41945,
              obligationType:
                "fire_insurance",
              providerName:
                "Farm Bureau",
              providerReference:
                "policy-reference",
              notes:
                "Policy amount $419.45; imported payment $423.40; $3.95 variance retained.",
              ownerId:
                " owner_1 ",
            });

        expect(
          verified,
        ).toMatchObject({
          servicePeriodStart:
            "2026-03-19",
          servicePeriodEnd:
            "2027-03-19",
          status: "active",
          verificationStatus:
            "document_verified",
          recognitionStatus:
            "accrual_ready",
          obligationType:
            "fire_insurance",
          providerName:
            "Farm Bureau",
          providerReference:
            "policy-reference",
          annualAmountCents:
            41945,
          paidAmountCents:
            42340,
          paymentDate:
            "2026-03-19",
          reconciledFinancialEventId:
            "financial_event_insurance",
          updatedAt:
            "2026-08-09T17:00:00.000Z",
        });
      },
    );

    it(
      "rejects coverage verification for an obligation outside the owner scope",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const application =
          new PropertyOperatingObligationApplication({
            repository,
          });

        await application.save(
          obligation(),
          "owner_1",
        );

        await expect(
          application.verifyCoverage({
            obligationId:
              "obligation_1",
            servicePeriodStart:
              "2026-03-19",
            servicePeriodEnd:
              "2027-03-19",
            ownerId:
              "owner_2",
          }),
        ).rejects.toThrow(
          "Property operating obligation was not found.",
        );
      },
    );

    it(
      "rejects incomplete or reversed verified coverage periods",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const application =
          new PropertyOperatingObligationApplication({
            repository,
          });

        await application.save(
          obligation(),
          "owner_1",
        );

        await expect(
          application.verifyCoverage({
            obligationId:
              "obligation_1",
            servicePeriodStart:
              "2027-03-19",
            servicePeriodEnd:
              "2026-03-19",
            ownerId:
              "owner_1",
          }),
        ).rejects.toThrow(
          "service period end must follow its start",
        );
      },
    );

    it(
      "reconciles one imported payment idempotently",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const clock = vi.fn(() =>
          "2026-08-09T15:00:00.000Z"
        );
        const application =
          new PropertyOperatingObligationApplication({
            repository,
            clock,
          });

        await application.save(
          obligation(),
          "owner_1",
        );

        const reconciled =
          await application
            .reconcilePayment({
              obligationId:
                "obligation_1",
              financialEventId:
                "financial_event_tax",
              ownerId:
                "owner_1",
            });

        expect(
          reconciled
            .reconciledFinancialEventId,
        ).toBe(
          "financial_event_tax",
        );
        expect(
          reconciled.updatedAt,
        ).toBe(
          "2026-08-09T15:00:00.000Z",
        );

        await expect(
          application
            .reconcilePayment({
              obligationId:
                "obligation_1",
              financialEventId:
                "financial_event_tax",
              ownerId:
                "owner_1",
            }),
        ).resolves.toEqual(
          reconciled,
        );
      },
    );

    it(
      "prevents reconciliation from silently changing payments",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();
        const application =
          new PropertyOperatingObligationApplication({
            repository,
          });

        await application.save(
          obligation({
            reconciledFinancialEventId:
              "financial_event_1",
          }),
          "owner_1",
        );

        await expect(
          application
            .reconcilePayment({
              obligationId:
                "obligation_1",
              financialEventId:
                "financial_event_2",
              ownerId:
                "owner_1",
            }),
        ).rejects.toThrow(
          "Property operating obligation is already reconciled to another financial event.",
        );
      },
    );
  },
);

describe(
  "PropertyOperatingObligationApplication spreadsheet import",
  () => {
    const csv = [
      "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
      "1/6/2026,1214 WAGNER,Property Tax (COUNTY),,1000",
    ].join("\n");

    const properties = [
      {
        id: "1214-wagner",
        address: "1214 Wagner",
      },
    ];

    it(
      "previews without persistence",
      () => {
        const repository = {
          saveMany: vi.fn(),
        };
        const application =
          new PropertyOperatingObligationApplication({
            repository,
            clock: () =>
              "2026-08-09T16:00:00.000Z",
          });

        const preview =
          application.previewSpreadsheet({
            csv,
            properties,
            financialEvents: [],
          });

        expect(preview.valid).toBe(
          true,
        );
        expect(
          preview.obligationCount,
        ).toBe(1);
        expect(
          repository.saveMany,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "imports a valid preview through authenticated owner authority",
      async () => {
        const repository = {
          saveMany: vi.fn(
            async (obligations) =>
              obligations,
          ),
        };
        const application =
          new PropertyOperatingObligationApplication({
            repository,
            clock: () =>
              "2026-08-09T16:00:00.000Z",
          });

        const result =
          await application
            .importSpreadsheet({
              csv,
              properties,
              financialEvents: [],
              ownerId: " owner_1 ",
            });

        expect(
          repository.saveMany,
        ).toHaveBeenCalledWith(
          result.obligations,
          {
            ownerId: "owner_1",
          },
        );
        expect(
          result.importedCount,
        ).toBe(1);
        expect(
          Object.isFrozen(
            result.persistedObligations,
          ),
        ).toBe(true);
      },
    );

    it(
      "does not persist an invalid preview",
      async () => {
        const repository = {
          saveMany: vi.fn(),
        };
        const application =
          new PropertyOperatingObligationApplication({
            repository,
          });

        const result =
          await application
            .importSpreadsheet({
              csv,
              properties: [],
              financialEvents: [],
              ownerId: "owner_1",
            });

        expect(result.valid).toBe(
          false,
        );
        expect(
          result.importedCount,
        ).toBe(0);
        expect(
          repository.saveMany,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
