import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabaseFinancialAccountRepository,
} from "../SupabaseFinancialAccountRepository.js";

const query = {
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => query),
  },
}));

function buildAccount(overrides = {}) {
  return {
    id: "financial_account_plaid_account_1",
    connectionId: "connection_1",
    provider: "plaid",
    providerAccountId: "account_1",
    institutionId: "institution_1",
    name: "Operating Checking",
    officialName: "Business Operating Checking",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    currencyCode: "USD",
    active: true,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function buildRow(overrides = {}) {
  const account = buildAccount(overrides);

  return {
    id: account.id,
    owner_id: overrides.owner_id ?? "owner_1",
    connection_id: account.connectionId,
    provider: account.provider,
    provider_account_id: account.providerAccountId,
    institution_id: account.institutionId,
    name: account.name,
    official_name: account.officialName,
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    currency_code: account.currencyCode,
    active: account.active,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

describe("SupabaseFinancialAccountRepository", () => {
  beforeEach(() => {
    query.upsert.mockReset();
    query.select.mockReset();
    query.eq.mockReset();
    query.order.mockReset();
    query.maybeSingle.mockReset();

    query.upsert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
  });

  it("persists canonical financial accounts with owner context", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    const result = await repository.saveMany(
      [buildAccount()],
      {
        ownerId: "owner_1",
      },
    );

    expect(query.upsert).toHaveBeenCalledWith(
      [
        {
          id: "financial_account_plaid_account_1",
          owner_id: "owner_1",
          connection_id: "connection_1",
          provider: "plaid",
          provider_account_id: "account_1",
          institution_id: "institution_1",
          name: "Operating Checking",
          official_name: "Business Operating Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currency_code: "USD",
          active: true,
          created_at: "2026-07-15T00:00:00.000Z",
          updated_at: "2026-07-15T00:00:00.000Z",
        },
      ],
      {
        onConflict:
          "owner_id,provider,provider_account_id",
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(buildAccount());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("persists one financial account", async () => {
    query.select.mockResolvedValue({
      data: [buildRow()],
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    const result = await repository.save(
      buildAccount(),
      {
        ownerId: "owner_1",
      },
    );

    expect(result).toEqual(buildAccount());
  });

  it("returns an immutable empty result without calling Supabase", async () => {
    const repository =
      new SupabaseFinancialAccountRepository();

    const result = await repository.saveMany([], {
      ownerId: "owner_1",
    });

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("requires owner context when persisting accounts", async () => {
    const repository =
      new SupabaseFinancialAccountRepository();

    await expect(
      repository.saveMany([buildAccount()]),
    ).rejects.toThrow(
      "Financial account owner id is required",
    );
  });

  it("finds a financial account by id", async () => {
    query.maybeSingle.mockResolvedValue({
      data: buildRow(),
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    const result = await repository.findById(
      "financial_account_plaid_account_1",
    );

    expect(query.eq).toHaveBeenCalledWith(
      "id",
      "financial_account_plaid_account_1",
    );
    expect(result).toEqual(buildAccount());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns null when an account id is not found", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    await expect(
      repository.findById("missing"),
    ).resolves.toBeNull();
  });

  it("finds immutable accounts by connection", async () => {
    query.order.mockResolvedValue({
      data: [
        buildRow(),
        buildRow({
          id: "financial_account_plaid_account_2",
          providerAccountId: "account_2",
          name: "Savings",
          subtype: "savings",
        }),
      ],
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    const result = await repository.findByConnection(
      "connection_1",
    );

    expect(query.eq).toHaveBeenCalledWith(
      "connection_id",
      "connection_1",
    );
    expect(query.order).toHaveBeenCalledWith(
      "name",
      {
        ascending: true,
      },
    );
    expect(result).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("finds an account by provider account identity", async () => {
    query.maybeSingle.mockResolvedValue({
      data: buildRow(),
      error: null,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    const result =
      await repository.findByProviderAccountId(
        "plaid",
        "account_1",
      );

    expect(query.eq).toHaveBeenNthCalledWith(
      1,
      "provider",
      "plaid",
    );
    expect(query.eq).toHaveBeenNthCalledWith(
      2,
      "provider_account_id",
      "account_1",
    );
    expect(result).toEqual(buildAccount());
  });

  it("validates required query identifiers", async () => {
    const repository =
      new SupabaseFinancialAccountRepository();

    await expect(
      repository.findById(""),
    ).rejects.toThrow(
      "Financial account id is required",
    );

    await expect(
      repository.findByConnection(""),
    ).rejects.toThrow(
      "Connection id is required",
    );

    await expect(
      repository.findByProviderAccountId(
        "",
        "account_1",
      ),
    ).rejects.toThrow("Provider is required");

    await expect(
      repository.findByProviderAccountId(
        "plaid",
        "",
      ),
    ).rejects.toThrow(
      "Provider account id is required",
    );
  });

  it("propagates Supabase errors", async () => {
    const error = new Error("persistence failed");

    query.select.mockResolvedValue({
      data: null,
      error,
    });

    const repository =
      new SupabaseFinancialAccountRepository();

    await expect(
      repository.saveMany(
        [buildAccount()],
        {
          ownerId: "owner_1",
        },
      ),
    ).rejects.toBe(error);
  });
});
