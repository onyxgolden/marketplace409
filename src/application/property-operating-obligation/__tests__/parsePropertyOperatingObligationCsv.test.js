import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePropertyOperatingObligationCsv,
  previewPropertyOperatingObligationImport,
} from "../parsePropertyOperatingObligationCsv.js";

const properties = [
  {
    id: "1214-wagner",
    address: "1214 Wagner",
  },
  {
    id: "1218-wagner",
    address: "1218 Wagner",
  },
  {
    id: "420-south-29th",
    address: "420 South 29th",
  },
];

const csv = [
  "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
  '1/6/2026,1214 WAGNER,Property Tax (JEFFERSON COUNTY TAX OFFICE),,"2,884.86"',
  "1/24/2026,BUSINESS EXPENSES,Insurance (TX FARM BUREAU),,474",
  "2/25/2026,1218 WAGNER,Insurance (TX FARM BUREAU),,423.4",
  ",Totals,,0,3782.26",
].join("\n");

describe(
  "property operating obligation CSV import",
  () => {
    it(
      "parses quoted ledger cells and omits the totals row",
      () => {
        const parsed =
          parsePropertyOperatingObligationCsv(
            csv,
          );

        expect(
          parsed.rows,
        ).toHaveLength(3);
        expect(
          parsed.rows[0]
            .values.expense,
        ).toBe("2,884.86");
      },
    );

    it(
      "creates a verified 2025 tax accrual from its 2026 payment",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv,
            properties,
            clock: () =>
              "2026-08-09T15:30:00.000Z",
          });
        const tax =
          preview.obligations[0];

        expect(tax).toEqual(
          expect.objectContaining({
            propertyId:
              "1214-wagner",
            obligationType:
              "property_tax",
            annualAmountCents:
              288486,
            paidAmountCents:
              288486,
            paymentDate:
              "2026-01-06",
            servicePeriodStart:
              "2025-01-01",
            servicePeriodEnd:
              "2026-01-01",
            recognitionStatus:
              "accrual_ready",
            verificationStatus:
              "owner_confirmed",
          }),
        );
      },
    );

    it(
      "classifies business liability outside property NOI",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv,
            properties,
          });
        const liability =
          preview.obligations[1];

        expect(liability).toEqual(
          expect.objectContaining({
            scope: "portfolio",
            propertyId: null,
            obligationType:
              "business_liability_insurance",
            recognitionStatus:
              "pending",
            annualAmountCents:
              47400,
          }),
        );
      },
    );

    it(
      "uses owner classification rules without inventing policy dates",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv,
            properties,
          });
        const insurance =
          preview.obligations[2];

        expect(insurance).toEqual(
          expect.objectContaining({
            propertyId:
              "1218-wagner",
            obligationType:
              "fire_insurance",
            annualAmountCents:
              42340,
            servicePeriodStart:
              null,
            servicePeriodEnd:
              null,
            recognitionStatus:
              "pending",
          }),
        );
      },
    );

    it(
      "matches one canonical financial payment exactly",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv,
            properties,
            financialEvents: [
              {
                id:
                  "financial_event_tax",
                property_id:
                  "1214-wagner",
                event_date:
                  "2026-01-06",
                amount: 2884.86,
                transaction_kind:
                  "expense",
              },
            ],
          });

        expect(
          preview.obligations[0]
            .reconciledFinancialEventId,
        ).toBe(
          "financial_event_tax",
        );
        expect(
          preview.warnings,
        ).toHaveLength(2);
      },
    );

    it(
      "warns instead of guessing between duplicate payments",
      () => {
        const event = {
          propertyId:
            "1214-wagner",
          eventDate:
            "2026-01-06",
          amount: 2884.86,
        };
        const preview =
          previewPropertyOperatingObligationImport({
            csv:
              [
                "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
                '1/6/2026,1214 WAGNER,Property Tax (JEFFERSON COUNTY TAX OFFICE),,"2,884.86"',
              ].join("\n"),
            properties,
            financialEvents: [
              {
                ...event,
                id: "event_1",
              },
              {
                ...event,
                id: "event_2",
              },
            ],
          });

        expect(
          preview.obligations[0]
            .reconciledFinancialEventId,
        ).toBeNull();
        expect(
          preview.warnings[0]
            .code,
        ).toBe(
          "financial_event_ambiguous",
        );
      },
    );

    it(
      "rejects unmatched properties without inventing identifiers",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv:
              [
                "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
                "1/6/2026,UNKNOWN HOUSE,Property Tax (COUNTY),,1000",
              ].join("\n"),
            properties,
          });

        expect(preview.valid).toBe(
          false,
        );
        expect(
          preview.obligations,
        ).toEqual([]);
        expect(
          preview.errors[0]
            .message,
        ).toContain(
          "was not found in the property catalog",
        );
      },
    );

    it(
      "normalizes common address words while retaining catalog authority",
      () => {
        const preview =
          previewPropertyOperatingObligationImport({
            csv:
              [
                "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
                "1/6/2026,420 SOUTH 29TH,Property Tax (COUNTY),,1000",
              ].join("\n"),
            properties,
          });

        expect(
          preview.obligations[0]
            .propertyId,
        ).toBe(
          "420-south-29th",
        );
      },
    );

    it(
      "rejects malformed CSV and invalid payments",
      () => {
        expect(() =>
          parsePropertyOperatingObligationCsv(
            "property,expense\n1214 Wagner,100",
          ),
        ).toThrow(
          "missing required headers",
        );

        const preview =
          previewPropertyOperatingObligationImport({
            csv:
              [
                "DATE,PROPERTY,DESCRIPTION,INCOME,EXPENSE",
                "bad,1214 WAGNER,Property Tax (COUNTY),,invalid",
              ].join("\n"),
            properties,
          });

        expect(preview.valid).toBe(
          false,
        );
        expect(
          preview.invalidRowCount,
        ).toBe(1);
      },
    );
  },
);
