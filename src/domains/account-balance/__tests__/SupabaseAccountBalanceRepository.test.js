import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabaseAccountBalanceRepository,
} from "../SupabaseAccountBalanceRepository.js";

const query = {
  upsert: vi.fn(),
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

function buildBalance(overrides = {}) {
  return {
    id:
      "account_balance_plaid_account_1_" +
      "2026-07-15T00:00:00.000Z",
    financialAccountId:
      "financial_account_plaid_account_1",
    connectionId: "connection_1",
    provider: "plaid",
    providerAccountId: "account_1",
    currencyCode: "USD",
    currentBalanceCents: 125055,
    availableBalanceCents: 100025,
    asOf: "2026-07-15T00:00:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function buildRow(overrides = {}) {
  const balance = buildBalance(overrides);

  return {
    id: balance.id,
    owner_id: overrides.owner_id ?? "owner_1",
    financial_account_id:
      balance.financialAccountId,
    connection_id: balance.connectionId,
    provider: balance.provider,
    provider_account_id:
      balance.providerAccountId,
    currency_code: balance.currencyCode,
    current_balance_cents:
      balance.currentBalanceCents,
    available_balance_cents:
      balance.availableBalanceCents,
    as_of: balance.asOf,
    created_at: balance.createdAt,
  };
}

describe("SupabaseAccountBalanceRepository", () => {
  beforeEach(() => {
    query.upsert.mockReset();
    query.select.mockReset();
    query.eq.mockReset();
    query.order.mockReset();
    query.limit.mockReset();
    query.maybeSingle.mockReset();

    query.upsert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
  });

  it("persists canonical account balance snapshots with owner context", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result = await repository.saveMany(
      [buildBalance()],
      {
        ownerId: "owner_1",
      },
    );

    expect(query.upsert).toHaveBeenCalledWith(
      [
        {
          id:
            "account_balance_plaid_account_1_" +
            "2026-07-15T00:00:00.000Z",
          owner_id: "owner_1",
          financial_account_id:
            "financial_account_plaid_account_1",
          connection_id: "connection_1",
          provider: "plaid",
          provider_account_id: "account_1",
          currency_code: "USD",
          current_balance_cents: 125055,
          available_balance_cents: 100025,
          as_of:
            "2026-07-15T00:00:00.000Z",
          created_at:
            "2026-07-15T00:00:00.000Z",
        },
      ],
      {
        onConflict:
          "owner_id,financial_account_id,as_of",
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(buildBalance());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("persists one account balance snapshot", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result = await repository.save(
      buildBalance(),
      {
        ownerId: "owner_1",
      },
    );

    expect(result).toEqual(buildBalance());
  });

  it("preserves a null available balance", async () => {
    query.select.mockResolvedValue({
      data: [
        buildRow({
          availableBalanceCents: null,
        }),
      ],
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result = await repository.saveMany(
      [
        buildBalance({
          availableBalanceCents: null,
        }),
      ],
      {
        ownerId: "owner_1",
      },
    );

    expect(query.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          available_balance_cents: null,
        }),
      ],
      expect.any(Object),
    );

    expect(
      result[0].availableBalanceCents,
    ).toBeNull();
  });

  it("returns an immutable empty result without calling Supabase", async () => {
    const repository =
      new SupabaseAccountBalanceRepository();

    const result = await repository.saveMany(
      [],
      {
        ownerId: "owner_1",
      },
    );

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("requires owner context when persisting balances", async () => {
    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.saveMany([buildBalance()]),
    ).rejects.toThrow(
      "Account balance owner id is required",
    );
  });

  it("requires balances to be an array", async () => {
    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.saveMany(null, {
        ownerId: "owner_1",
      }),
    ).rejects.toThrow(
      "Account balances must be an array",
    );
  });

  it("finds immutable balances by financial account in chronological order", async () => {
    query.order.mockResolvedValue({
      data: [
        buildRow(),
        buildRow({
          id:
            "account_balance_plaid_account_1_" +
            "2026-07-16T00:00:00.000Z",
          currentBalanceCents: 130000,
          asOf:
            "2026-07-16T00:00:00.000Z",
          createdAt:
            "2026-07-16T00:00:00.000Z",
        }),
      ],
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result =
      await repository.findByFinancialAccount(
        "financial_account_plaid_account_1",
      );

    expect(query.eq).toHaveBeenCalledWith(
      "financial_account_id",
      "financial_account_plaid_account_1",
    );

    expect(query.order).toHaveBeenCalledWith(
      "as_of",
      {
        ascending: true,
      },
    );

    expect(result).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("finds the latest balance by financial account", async () => {
    query.maybeSingle.mockResolvedValue({
      data: buildRow(),
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result =
      await repository
        .findLatestByFinancialAccount(
          "financial_account_plaid_account_1",
        );

    expect(query.order).toHaveBeenCalledWith(
      "as_of",
      {
        ascending: false,
      },
    );

    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(buildBalance());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns null when no latest balance exists", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.findLatestByFinancialAccount(
        "financial_account_plaid_account_1",
      ),
    ).resolves.toBeNull();
  });

  it("finds immutable balances by connection", async () => {
    query.order.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    const result =
      await repository.findByConnection(
        "connection_1",
      );

    expect(query.eq).toHaveBeenCalledWith(
      "connection_id",
      "connection_1",
    );

    expect(query.order).toHaveBeenCalledWith(
      "as_of",
      {
        ascending: true,
      },
    );

    expect(result).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("requires financial account identity for balance queries", async () => {
    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.findByFinancialAccount(""),
    ).rejects.toThrow(
      "Financial account id is required",
    );

    await expect(
      repository.findLatestByFinancialAccount(
        "",
      ),
    ).rejects.toThrow(
      "Financial account id is required",
    );
  });

  it("requires connection identity for balance queries", async () => {
    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.findByConnection(""),
    ).rejects.toThrow(
      "Connection id is required",
    );
  });

  it("propagates Supabase persistence errors", async () => {
    const failure =
      new Error("balance persistence failed");

    query.select.mockResolvedValue({
      data: null,
      error: failure,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.saveMany(
        [buildBalance()],
        {
          ownerId: "owner_1",
        },
      ),
    ).rejects.toBe(failure);
  });

  it("propagates Supabase query errors", async () => {
    const failure =
      new Error("balance query failed");

    query.order.mockResolvedValue({
      data: null,
      error: failure,
    });

    const repository =
      new SupabaseAccountBalanceRepository();

    await expect(
      repository.findByConnection(
        "connection_1",
      ),
    ).rejects.toBe(failure);
  });
});
