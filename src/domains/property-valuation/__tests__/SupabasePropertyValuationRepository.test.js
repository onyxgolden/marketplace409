import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabasePropertyValuationRepository,
} from "../SupabasePropertyValuationRepository.js";

const query = {
  insert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => query),
  },
}));

function buildValuation(overrides = {}) {
  return {
    id: "valuation_1",
    propertyId: "1214-wagner",
    valuationType: "owner_estimate",
    source: "manual",
    providerName: null,
    providerReference: null,
    amountCents: 22500000,
    currencyCode: "USD",
    effectiveAt:
      "2026-08-07T00:00:00.000Z",
    createdAt:
      "2026-08-07T01:00:00.000Z",
    notes: "Owner supplied.",
    ...overrides,
  };
}

function buildRow(overrides = {}) {
  const valuation =
    buildValuation(overrides);

  return {
    id: valuation.id,
    owner_id:
      overrides.owner_id ?? "owner_1",
    property_id: valuation.propertyId,
    valuation_type:
      valuation.valuationType,
    source: valuation.source,
    provider_name:
      valuation.providerName,
    provider_reference:
      valuation.providerReference,
    amount_cents:
      valuation.amountCents,
    currency_code:
      valuation.currencyCode,
    effective_at:
      valuation.effectiveAt,
    created_at:
      valuation.createdAt,
    notes: valuation.notes,
  };
}

describe("SupabasePropertyValuationRepository", () => {
  beforeEach(() => {
    for (
      const method of Object.values(query)
    ) {
      method.mockReset();
      method.mockReturnValue(query);
    }
  });

  it("inserts immutable owner-scoped valuation snapshots", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    const result = await repository.saveMany(
      [buildValuation()],
      {
        ownerId: "owner_1",
      },
    );

    expect(query.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "valuation_1",
        owner_id: "owner_1",
        property_id: "1214-wagner",
        amount_cents: 22500000,
      }),
    ]);
    expect(result).toEqual([
      buildValuation(),
    ]);
    expect(Object.isFrozen(result)).toBe(
      true,
    );
  });

  it("returns an immutable empty result without persistence", async () => {
    const repository =
      new SupabasePropertyValuationRepository();

    const result = await repository.saveMany(
      [],
      {
        ownerId: "owner_1",
      },
    );

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(
      true,
    );
    expect(query.insert).not.toHaveBeenCalled();
  });

  it("requires owner context for writes", async () => {
    const repository =
      new SupabasePropertyValuationRepository();

    await expect(
      repository.save(
        buildValuation(),
      ),
    ).rejects.toThrow(
      "Property valuation owner id is required.",
    );
  });

  it("finds owner-scoped valuation history by property", async () => {
    query.order.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    const result =
      await repository.findByProperty(
        "1214-wagner",
        "owner_1",
      );

    expect(query.eq).toHaveBeenCalledWith(
      "owner_id",
      "owner_1",
    );
    expect(query.eq).toHaveBeenCalledWith(
      "property_id",
      "1214-wagner",
    );
    expect(query.order).toHaveBeenCalledWith(
      "effective_at",
      {
        ascending: false,
      },
    );
    expect(result).toEqual([
      buildValuation(),
    ]);
  });

  it("finds the latest valuation for a property", async () => {
    query.maybeSingle.mockResolvedValue({
      data: buildRow(),
      error: null,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    const result =
      await repository.findLatestByProperty(
        "1214-wagner",
        "owner_1",
      );

    expect(query.limit).toHaveBeenCalledWith(
      1,
    );
    expect(result).toEqual(
      buildValuation(),
    );
  });

  it("returns null when no valuation exists", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    await expect(
      repository.findById(
        "valuation_1",
        "owner_1",
      ),
    ).resolves.toBeNull();
  });

  it("selects one latest valuation per property for an owner", async () => {
    query.order.mockResolvedValue({
      data: [
        buildRow({
          id: "property_1_new",
        }),
        buildRow({
          id: "property_1_old",
          effectiveAt:
            "2026-01-01T00:00:00.000Z",
        }),
        buildRow({
          id: "property_2_new",
          propertyId: "1218-wagner",
        }),
      ],
      error: null,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    const result =
      await repository.findLatestByOwnerId(
        "owner_1",
      );

    expect(
      result.map(({ id }) => id),
    ).toEqual([
      "property_1_new",
      "property_2_new",
    ]);
  });

  it("propagates Supabase failures", async () => {
    const failure =
      new Error("valuation query failed");

    query.order.mockResolvedValue({
      data: null,
      error: failure,
    });

    const repository =
      new SupabasePropertyValuationRepository();

    await expect(
      repository.findByProperty(
        "1214-wagner",
        "owner_1",
      ),
    ).rejects.toBe(failure);
  });
});
