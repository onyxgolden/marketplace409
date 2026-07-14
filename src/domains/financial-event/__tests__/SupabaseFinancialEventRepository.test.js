import { beforeEach, describe, expect, test, vi } from "vitest";

import { SupabaseFinancialEventRepository } from "../SupabaseFinancialEventRepository";

const query = {
  insert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => query),
  },
}));

function buildEvent(overrides = {}) {
  return {
    id: "",
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
    created_by: null,
    updated_by: null,
    owner_id: "owner-1",
    organization_id: null,
    status: "active",
    is_deleted: false,
    deleted_at: null,
    property_id: "170-john",
    financial_account_id: null,
    event_date: "2026-07-01",
    description: "Rental Income",
    amount: 1500,
    transaction_kind: "income",
    normalized_category: "rental_income",
    tax_deductible: false,
    affects_noi: true,
    capitalized: false,
    source_system: "rentec",
    source_record_id: "rentec-1",
    metadata: {
      propertyName: "170 John",
    },
    ...overrides,
  };
}

function buildRow(overrides = {}) {
  return {
    ...buildEvent({
      id: "event-1",
      ...overrides,
    }),
    amount: String(overrides.amount ?? 1500),
  };
}

describe("SupabaseFinancialEventRepository", () => {
  beforeEach(() => {
    query.insert.mockReset();
    query.select.mockReset();
    query.eq.mockReset();
    query.order.mockReset();

    query.insert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
  });

  test("persists canonical financial events", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository = new SupabaseFinancialEventRepository();
    const result = await repository.saveMany([buildEvent()]);

    expect(query.insert).toHaveBeenCalledWith([
      {
        owner_id: "owner-1",
        organization_id: null,
        property_id: "170-john",
        financial_account_id: null,
        event_date: "2026-07-01",
        description: "Rental Income",
        amount: 1500,
        transaction_kind: "income",
        normalized_category: "rental_income",
        tax_deductible: false,
        affects_noi: true,
        capitalized: false,
        source_system: "rentec",
        source_record_id: "rentec-1",
        metadata: {
          propertyName: "170 John",
        },
        status: "active",
        is_deleted: false,
        deleted_at: null,
        created_by: null,
        updated_by: null,
        created_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:00:00.000Z",
      },
    ]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "event-1",
      owner_id: "owner-1",
      property_id: "170-john",
      amount: 1500,
      source_record_id: "rentec-1",
    });
  });

  test("omits empty event ids so the database can generate them", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository = new SupabaseFinancialEventRepository();

    await repository.saveMany([buildEvent({ id: "" })]);

    expect(query.insert.mock.calls[0][0][0]).not.toHaveProperty("id");
  });

  test("preserves explicit event ids", async () => {
    query.select.mockResolvedValue({
      data: [buildRow({ id: "event-explicit" })],
      error: null,
    });

    const repository = new SupabaseFinancialEventRepository();

    await repository.saveMany([
      buildEvent({
        id: "event-explicit",
      }),
    ]);

    expect(query.insert.mock.calls[0][0][0]).toMatchObject({
      id: "event-explicit",
    });
  });

  test("returns an immutable empty result without calling Supabase", async () => {
    const repository = new SupabaseFinancialEventRepository();
    const result = await repository.saveMany([]);

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(query.insert).not.toHaveBeenCalled();
  });

  test("finds immutable financial events by owner id", async () => {
    query.order.mockResolvedValue({
      data: [
        buildRow({
          id: "event-1",
          owner_id: "owner-1",
        }),
        buildRow({
          id: "event-2",
          owner_id: "owner-1",
          event_date: "2026-07-02",
        }),
      ],
      error: null,
    });

    const repository = new SupabaseFinancialEventRepository();
    const result = await repository.findByOwnerId("owner-1");

    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(query.order).toHaveBeenCalledWith("event_date", {
      ascending: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(result.map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
    ]);
  });

  test("counts financial events within the owner boundary", async () => {
    query.eq.mockResolvedValue({
      count: 3,
      error: null,
    });

    const repository = new SupabaseFinancialEventRepository();
    const result = await repository.count("owner-1");

    expect(query.select).toHaveBeenCalledWith("*", {
      count: "exact",
      head: true,
    });
    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(result).toBe(3);
  });

  test("requires owner id for owner-scoped queries", async () => {
    const repository = new SupabaseFinancialEventRepository();

    await expect(repository.findByOwnerId(null)).rejects.toThrow(
      "Owner id is required",
    );

    await expect(repository.count("")).rejects.toThrow(
      "Owner id is required",
    );
  });

  test("requires owner id on persisted financial events", async () => {
    const repository = new SupabaseFinancialEventRepository();

    await expect(
      repository.saveMany([
        buildEvent({
          owner_id: null,
        }),
      ]),
    ).rejects.toThrow("Financial event owner_id is required");
  });

  test("propagates Supabase persistence errors", async () => {
    const error = new Error("insert failed");

    query.select.mockResolvedValue({
      data: null,
      error,
    });

    const repository = new SupabaseFinancialEventRepository();

    await expect(
      repository.saveMany([buildEvent()]),
    ).rejects.toBe(error);
  });
});
