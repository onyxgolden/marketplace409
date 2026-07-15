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
  createFinancialAccountRepository,
  FinancialAccountRepositoryStorage,
} from "../createFinancialAccountRepository.js";

import {
  InMemoryFinancialAccountRepository,
} from "../../../domains/financial-account/in-memory-financial-account.repository";

import {
  SupabaseFinancialAccountRepository,
} from "../../../domains/financial-account/SupabaseFinancialAccountRepository.js";

describe("createFinancialAccountRepository", () => {
  const originalStorage =
    process.env.FINANCIAL_ACCOUNT_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.FINANCIAL_ACCOUNT_REPOSITORY;
    } else {
      process.env.FINANCIAL_ACCOUNT_REPOSITORY =
        originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.FINANCIAL_ACCOUNT_REPOSITORY;

    const repository =
      await createFinancialAccountRepository();

    expect(repository).toBeInstanceOf(
      InMemoryFinancialAccountRepository,
    );
  });

  it("creates an in-memory repository when selected", async () => {
    const repository =
      await createFinancialAccountRepository({
        storage:
          FinancialAccountRepositoryStorage.MEMORY,
      });

    expect(repository).toBeInstanceOf(
      InMemoryFinancialAccountRepository,
    );
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.FINANCIAL_ACCOUNT_REPOSITORY =
      FinancialAccountRepositoryStorage.MEMORY;

    const repository =
      await createFinancialAccountRepository();

    expect(repository).toBeInstanceOf(
      InMemoryFinancialAccountRepository,
    );
  });

  it("creates a Supabase repository when selected", async () => {
    const repository =
      await createFinancialAccountRepository({
        storage:
          FinancialAccountRepositoryStorage.SUPABASE,
      });

    expect(repository).toBeInstanceOf(
      SupabaseFinancialAccountRepository,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createFinancialAccountRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported financial account repository storage: unsupported",
    );
  });
});
