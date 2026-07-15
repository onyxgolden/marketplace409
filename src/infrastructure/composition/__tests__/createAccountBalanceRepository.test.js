import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import {
  createAccountBalanceRepository,
  createLazyAccountBalanceRepository,
} from "../createAccountBalanceRepository.js";

import {
  InMemoryAccountBalanceRepository,
} from "../../../domains/account-balance/in-memory-account-balance.repository";

import {
  SupabaseAccountBalanceRepository,
} from "../../../domains/account-balance/SupabaseAccountBalanceRepository.js";

describe("createAccountBalanceRepository", () => {
  const originalStorage =
    process.env.ACCOUNT_BALANCE_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.ACCOUNT_BALANCE_REPOSITORY;
    } else {
      process.env.ACCOUNT_BALANCE_REPOSITORY =
        originalStorage;
    }
  });

  it("creates the in-memory repository by default", async () => {
    delete process.env.ACCOUNT_BALANCE_REPOSITORY;

    const repository =
      await createAccountBalanceRepository();

    expect(repository).toBeInstanceOf(
      InMemoryAccountBalanceRepository,
    );
  });

  it("creates the in-memory repository when selected", async () => {
    const repository =
      await createAccountBalanceRepository({
        storage: "memory",
      });

    expect(repository).toBeInstanceOf(
      InMemoryAccountBalanceRepository,
    );
  });

  it("creates the Supabase repository when selected", async () => {
    const repository =
      await createAccountBalanceRepository({
        storage: "supabase",
      });

    expect(repository).toBeInstanceOf(
      SupabaseAccountBalanceRepository,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createAccountBalanceRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported account balance repository storage: unsupported",
    );
  });

  it("exposes a lazy synchronous repository boundary", () => {
    const repository =
      createLazyAccountBalanceRepository();

    expect(typeof repository.save).toBe("function");
    expect(typeof repository.saveMany).toBe("function");

    expect(
      typeof repository.findByFinancialAccount,
    ).toBe("function");

    expect(
      typeof repository.findLatestByFinancialAccount,
    ).toBe("function");

    expect(
      typeof repository.findByConnection,
    ).toBe("function");

    expect(Object.isFrozen(repository)).toBe(true);
  });
});
