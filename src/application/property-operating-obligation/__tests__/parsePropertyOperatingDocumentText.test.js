import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePropertyOperatingDocumentText,
} from "../parsePropertyOperatingDocumentText.js";

describe(
  "parsePropertyOperatingDocumentText",
  () => {
    it(
      "proposes the complete South 29th declaration without treating the location subtotal as total cost",
      () => {
        const result =
          parsePropertyOperatingDocumentText(`
            DWELLING POLICY DECLARATIONS
            Underwritten by: Scottsdale Insurance Company
            Policy Number DFS5003139
            Policy Period: From: 12-16-2025 To: 12-16-2026
            The Described Location: 420 S 29TH ST, NEDERLAND, TX 77627
            A—Dwelling (ACV) $ 96,000
            FIRE 292 EXTENDED COVERAGES 125
            LOCATION TOTAL: $ 417.00
            Property (All Other Perils): $2,500
            Windstorm or Hail: EXCLUDED
            Policy Premium: $500.00
            Total Taxes & Fees: $286.68
            Total Premium: $786.68
          `);

        expect(result).toMatchObject({
          parserVersion:
            "property-operating-document-v1",
          requiresReview: true,
          confidence: "high",
          documentType:
            "insurance_policy",
          proposal: {
            obligationType:
              "fire_insurance",
            annualAmountCents:
              78668,
            servicePeriodStart:
              "2025-12-16",
            servicePeriodEnd:
              "2026-12-16",
            providerName:
              "Scottsdale Insurance Company",
            providerReference:
              "DFS5003139",
            detectedAddress:
              "420 S 29TH ST, NEDERLAND, TX 77627",
            facts: {
              policyPremiumCents:
                50000,
              taxesAndFeesCents:
                28668,
              totalPremiumCents:
                78668,
              locationTotalCents:
                41700,
              dwellingLimitCents:
                9600000,
              deductibleCents:
                250000,
              windExcluded: true,
            },
          },
          warnings: [],
        });

        expect(
          result.proposal.notes,
        ).toContain(
          "Windstorm or hail excluded.",
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);
      },
    );

    it(
      "proposes an annual property-tax obligation",
      () => {
        const result =
          parsePropertyOperatingDocumentText(`
            JEFFERSON COUNTY TAX OFFICE
            2025 PROPERTY TAX STATEMENT
            Account Number: 123-456
            Property Address: 420 S 29TH ST
            Total Due: $2,157.55
          `);

        expect(result).toMatchObject({
          confidence: "high",
          documentType:
            "property_tax_statement",
          proposal: {
            obligationType:
              "property_tax",
            annualAmountCents:
              215755,
            servicePeriodStart:
              "2025-01-01",
            servicePeriodEnd:
              "2026-01-01",
            providerName:
              "JEFFERSON COUNTY TAX OFFICE",
            providerReference:
              "123-456",
            detectedAddress:
              "420 S 29TH ST",
            taxYear: 2025,
          },
          warnings: [],
        });
      },
    );

    it(
      "returns a reviewable incomplete proposal instead of inventing values",
      () => {
        const result =
          parsePropertyOperatingDocumentText(`
            INSURANCE POLICY DECLARATIONS
            Carrier information unavailable
          `);

        expect(result).toMatchObject({
          confidence: "medium",
          documentType:
            "insurance_policy",
          requiresReview: true,
          proposal: {
            annualAmountCents:
              null,
            servicePeriodStart:
              null,
            servicePeriodEnd:
              null,
          },
          warnings: [
            "Annual amount requires review.",
            "Service-period dates require review.",
          ],
        });
      },
    );

    it(
      "flags an unknown document and rejects empty text",
      () => {
        const result =
          parsePropertyOperatingDocumentText(
            "Unrecognized property document content.",
          );

        expect(result).toMatchObject({
          confidence: "low",
          documentType:
            "unknown",
          warnings: [
            "Annual amount requires review.",
            "Service-period dates require review.",
            "Document type requires review.",
          ],
        });

        expect(() =>
          parsePropertyOperatingDocumentText(
            " ",
          ),
        ).toThrow(
          "document text is required",
        );
      },
    );

    it(
      "parses scanned declarations when OCR separates labels and values",
      () => {
        const result =
          parsePropertyOperatingDocumentText(`
            DWELLING POLICY DECLARATIONS

            Underwritten by:
            Scottsdale Insurance Company

            Policy Number:
            DFS5003139

            Policy Period:
            From:
            12–16–2025
            To:
            12–16–2026

            The Described Location:
            420 S 29TH ST, NEDERLAND, TX 77627

            FIRE

            Deductibles:
            Property (All Other Perils):
            $ 2,500

            Windstorm or Hail:
            EXCLUDED

            Policy Totals:
            Policy Premium:
            Total Taxes & Fees:
            Total Premium:
            Minimum Earned Premium:

            $
            $
            $
            $

            500.00
            286.68
            786.68
            125.00
          `);

        expect(
          result.documentType,
        ).toBe(
          "insurance_policy",
        );
        expect(
          result.confidence,
        ).toBe(
          "high",
        );
        expect(
          result.warnings,
        ).toEqual(
          [],
        );
        expect(
          result.proposal,
        ).toEqual(
          expect.objectContaining({
            obligationType:
              "fire_insurance",
            annualAmountCents:
              78668,
            servicePeriodStart:
              "2025-12-16",
            servicePeriodEnd:
              "2026-12-16",
            providerName:
              "Scottsdale Insurance Company",
            providerReference:
              "DFS5003139",
            detectedAddress:
              "420 S 29TH ST, NEDERLAND, TX 77627",
          }),
        );
        expect(
          result.proposal.notes,
        ).toContain(
          "Other-perils deductible $2,500.00.",
        );
        expect(
          result.proposal.notes,
        ).toContain(
          "Windstorm or hail excluded.",
        );
      },
    );
  },
);
