import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyOperatingObligationRepository,
} from "../in-memory-property-operating-obligation.repository";

import {
  createPropertyOperatingObligation,
} from "../property-operating-obligation.types";

function buildObligation({
  id = "obligation_1",
  propertyId = "1214-wagner",
  obligationType = "property_tax",
  servicePeriodStart = "2025-01-01",
  servicePeriodEnd = "2026-01-01",
  reconciledFinancialEventId = null,
}: {
  id?: string;
  propertyId?: string;
  obligationType?:
    | "property_tax"
    | "fire_insurance";
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  reconciledFinancialEventId?:
    string | null;
} = {}) {
  return createPropertyOperatingObligation({
    id,
    scope: "property",
    propertyId,
    subjectLabel:
      `${propertyId} annual obligation`,
    obligationType,
    annualAmountCents: 120000,
    currencyCode: "USD",
    servicePeriodStart,
    servicePeriodEnd,
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
    reconciledFinancialEventId,
    cancelledAt: null,
    createdAt:
      `${servicePeriodStart}T12:00:00.000Z`,
    updatedAt:
      `${servicePeriodStart}T12:00:00.000Z`,
    notes: null,
  });
}

describe(
  "InMemoryPropertyOperatingObligationRepository",
  () => {
    it(
      "saves and retrieves owner-scoped obligations",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await repository.save(
          buildObligation(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.findById(
            "obligation_1",
            "owner_1",
          ),
        ).resolves.toEqual(
          buildObligation(),
        );

        await expect(
          repository.findById(
            "obligation_1",
            "owner_2",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "lists property history newest first",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await repository.saveMany(
          [
            buildObligation({
              id: "tax_2024",
              servicePeriodStart:
                "2024-01-01",
              servicePeriodEnd:
                "2025-01-01",
            }),
            buildObligation({
              id: "tax_2025",
              servicePeriodStart:
                "2025-01-01",
              servicePeriodEnd:
                "2026-01-01",
            }),
          ],
          {
            ownerId: "owner_1",
          },
        );

        const listed =
          await repository.findByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          listed.map(({ id }) => id),
        ).toEqual([
          "tax_2025",
          "tax_2024",
        ]);
        expect(
          Object.isFrozen(listed),
        ).toBe(true);
      },
    );

    it(
      "filters by type, status, recognition, and reconciliation",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await repository.saveMany(
          [
            buildObligation({
              id: "unreconciled_tax",
            }),
            buildObligation({
              id: "reconciled_fire",
              obligationType:
                "fire_insurance",
              reconciledFinancialEventId:
                "event_1",
            }),
          ],
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.list(
            {
              obligationType:
                "property_tax",
              status: "active",
              recognitionStatus:
                "accrual_ready",
              unreconciledOnly: true,
            },
            "owner_1",
          ),
        ).resolves.toEqual([
          buildObligation({
            id: "unreconciled_tax",
          }),
        ]);
      },
    );

    it(
      "prevents an existing identity from changing owners",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await repository.save(
          buildObligation(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.save(
            buildObligation(),
            {
              ownerId: "owner_2",
            },
          ),
        ).rejects.toThrow(
          "Property operating obligation owner mismatch.",
        );
      },
    );

    it(
      "deletes only through matching owner authority",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await repository.save(
          buildObligation(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.deleteById(
            "obligation_1",
            "owner_2",
          ),
        ).resolves.toBeNull();

        await expect(
          repository.deleteById(
            "obligation_1",
            "owner_1",
          ),
        ).resolves.toEqual(
          buildObligation(),
        );
      },
    );

    it(
      "requires owner authority for reads and writes",
      async () => {
        const repository =
          new InMemoryPropertyOperatingObligationRepository();

        await expect(
          repository.save(
            buildObligation(),
            {} as never,
          ),
        ).rejects.toThrow(
          "Property operating obligation owner id is required.",
        );

        await expect(
          repository.list(
            {},
            "",
          ),
        ).rejects.toThrow(
          "Property operating obligation owner id is required.",
        );
      },
    );
  },
);
