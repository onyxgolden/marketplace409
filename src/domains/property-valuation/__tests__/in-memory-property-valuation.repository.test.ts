import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyValuationRepository,
} from "../in-memory-property-valuation.repository";

import {
  createPropertyValuation,
} from "../property-valuation.types";

function buildValuation({
  id = "valuation_1",
  propertyId = "property_1",
  amountCents = 22500000,
  effectiveAt = "2026-08-07T00:00:00.000Z",
} = {}) {
  return createPropertyValuation({
    id,
    propertyId,
    valuationType: "owner_estimate",
    source: "manual",
    providerName: null,
    providerReference: null,
    amountCents,
    currencyCode: "USD",
    effectiveAt,
    createdAt: effectiveAt,
    notes: null,
  });
}

describe("InMemoryPropertyValuationRepository", () => {
  it("saves and retrieves owner-scoped valuation history", async () => {
    const repository =
      new InMemoryPropertyValuationRepository();

    await repository.saveMany(
      [
        buildValuation({
          id: "valuation_old",
          amountCents: 20000000,
          effectiveAt:
            "2026-01-01T00:00:00.000Z",
        }),
        buildValuation({
          id: "valuation_new",
          amountCents: 22500000,
          effectiveAt:
            "2026-08-07T00:00:00.000Z",
        }),
      ],
      {
        ownerId: "owner_1",
      },
    );

    const history =
      await repository.findByProperty(
        "property_1",
        "owner_1",
      );

    expect(history.map(({ id }) => id)).toEqual([
      "valuation_new",
      "valuation_old",
    ]);

    await expect(
      repository.findByProperty(
        "property_1",
        "owner_2",
      ),
    ).resolves.toEqual([]);
  });

  it("finds the latest valuation for a property", async () => {
    const repository =
      new InMemoryPropertyValuationRepository();

    await repository.saveMany(
      [
        buildValuation({
          id: "valuation_old",
          effectiveAt:
            "2026-01-01T00:00:00.000Z",
        }),
        buildValuation({
          id: "valuation_new",
          effectiveAt:
            "2026-08-07T00:00:00.000Z",
        }),
      ],
      {
        ownerId: "owner_1",
      },
    );

    const latest =
      await repository.findLatestByProperty(
        "property_1",
        "owner_1",
      );

    expect(latest?.id).toBe("valuation_new");
  });

  it("finds one latest valuation per property for an owner", async () => {
    const repository =
      new InMemoryPropertyValuationRepository();

    await repository.saveMany(
      [
        buildValuation({
          id: "property_1_old",
          propertyId: "property_1",
          effectiveAt:
            "2026-01-01T00:00:00.000Z",
        }),
        buildValuation({
          id: "property_1_new",
          propertyId: "property_1",
          effectiveAt:
            "2026-08-07T00:00:00.000Z",
        }),
        buildValuation({
          id: "property_2_new",
          propertyId: "property_2",
          effectiveAt:
            "2026-07-01T00:00:00.000Z",
        }),
      ],
      {
        ownerId: "owner_1",
      },
    );

    const latest =
      await repository.findLatestByOwnerId(
        "owner_1",
      );

    expect(
      latest.map(({ id }) => id),
    ).toEqual([
      "property_1_new",
      "property_2_new",
    ]);
  });

  it("requires owner scope for writes and reads", async () => {
    const repository =
      new InMemoryPropertyValuationRepository();

    await expect(
      repository.save(
        buildValuation(),
        {} as never,
      ),
    ).rejects.toThrow(
      "Property valuation owner id is required.",
    );

    await expect(
      repository.findLatestByOwnerId(""),
    ).rejects.toThrow(
      "Property valuation owner id is required.",
    );
  });
});
