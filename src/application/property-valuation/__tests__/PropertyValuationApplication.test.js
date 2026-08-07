import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyValuationRepository,
} from "@/domains/property-valuation/in-memory-property-valuation.repository";

import {
  PropertyValuationApplication,
} from "../PropertyValuationApplication";

function createApplication() {
  let id = 0;

  const repository =
    new InMemoryPropertyValuationRepository();

  const application =
    new PropertyValuationApplication(
      repository,
      {
        clock: () =>
          "2026-08-07T12:00:00.000Z",
        idFactory: () =>
          `generated_${++id}`,
      },
    );

  return {
    application,
    repository,
  };
}

describe(
  "PropertyValuationApplication",
  () => {
    it(
      "records an owner-scoped manual valuation",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const valuation =
          await application.recordManual(
            {
              propertyId:
                "1214-wagner",
              amount: "$125,000.50",
              valuationType:
                "owner_estimate",
              effectiveAt:
                "2026-08-01",
              notes:
                "Owner supplied value",
            },
            "owner_1",
          );

        expect(
          valuation.amountCents,
        ).toBe(12500050);
        expect(valuation.source).toBe(
          "manual",
        );

        await expect(
          repository.findLatestByProperty(
            "1214-wagner",
            "owner_1",
          ),
        ).resolves.toEqual(
          valuation,
        );
      },
    );

    it(
      "previews normalized spreadsheet rows without persistence",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const preview =
          application.previewSpreadsheetRows([
            {
              property_id:
                "1214-wagner",
              current_value:
                "150000",
              valuation_type:
                "appraisal",
              valuation_date:
                "2026-08-01",
            },
          ]);

        expect(preview.valid).toBe(
          true,
        );
        expect(
          preview.validRowCount,
        ).toBe(1);
        expect(
          preview.valuations[0],
        ).toMatchObject({
          propertyId:
            "1214-wagner",
          amountCents: 15000000,
          source: "spreadsheet",
          valuationType:
            "appraisal",
        });

        await expect(
          repository.findLatestByOwnerId(
            "owner_1",
          ),
        ).resolves.toEqual([]);
      },
    );

    it(
      "reports spreadsheet errors with row numbers",
      () => {
        const {
          application,
        } = createApplication();

        const preview =
          application.previewSpreadsheetRows([
            {
              property_id:
                "1214-wagner",
              current_value:
                "125000",
            },
            {
              property_id: "",
              current_value:
                "invalid",
            },
          ]);

        expect(preview.valid).toBe(
          false,
        );
        expect(
          preview.validRowCount,
        ).toBe(1);
        expect(
          preview.invalidRowCount,
        ).toBe(1);
        expect(
          preview.errors[0].rowNumber,
        ).toBe(3);
      },
    );

    it(
      "does not partially persist an invalid spreadsheet",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const result =
          await application.importSpreadsheetRows(
            [
              {
                propertyId:
                  "1214-wagner",
                amount: 125000,
              },
              {
                propertyId:
                  "1218-wagner",
                amount: -1,
              },
            ],
            "owner_1",
          );

        expect(result.valid).toBe(
          false,
        );
        expect(
          result.importedCount,
        ).toBe(0);

        await expect(
          repository.findLatestByOwnerId(
            "owner_1",
          ),
        ).resolves.toEqual([]);
      },
    );

    it(
      "persists a valid spreadsheet atomically for its owner",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const result =
          await application.importSpreadsheetRows(
            [
              {
                propertyId:
                  "1214-wagner",
                amount: 125000,
              },
              {
                propertyId:
                  "1218-wagner",
                amount: 150000,
              },
            ],
            "owner_1",
          );

        expect(result.valid).toBe(
          true,
        );
        expect(
          result.importedCount,
        ).toBe(2);

        await expect(
          repository.findLatestByOwnerId(
            "owner_1",
          ),
        ).resolves.toHaveLength(
          2,
        );
      },
    );

    it(
      "rejects persistence without an owner",
      async () => {
        const {
          application,
        } = createApplication();

        await expect(
          application.recordManual(
            {
              propertyId:
                "1214-wagner",
              amount: 125000,
            },
            "",
          ),
        ).rejects.toThrow(
          "Property valuation owner ID is required.",
        );
      },
    );
  },
);
