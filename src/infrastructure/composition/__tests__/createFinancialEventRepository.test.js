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
  createFinancialEventRepository,
  FinancialEventRepositoryStorage,
} from "../createFinancialEventRepository.js";

import { InMemoryFinancialEventRepository } from "../../../domains/financial-event/InMemoryFinancialEventRepository.js";
import { SupabaseFinancialEventRepository } from "../../../domains/financial-event/SupabaseFinancialEventRepository.js";

describe("createFinancialEventRepository", () => {
  const originalStorage = process.env.FINANCIAL_EVENT_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.FINANCIAL_EVENT_REPOSITORY;
    } else {
      process.env.FINANCIAL_EVENT_REPOSITORY = originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.FINANCIAL_EVENT_REPOSITORY;

    const repository = await createFinancialEventRepository();

    expect(repository).toBeInstanceOf(InMemoryFinancialEventRepository);
  });

  it("creates an in-memory repository when explicitly selected", async () => {
    const repository = await createFinancialEventRepository({
      storage: FinancialEventRepositoryStorage.MEMORY,
    });

    expect(repository).toBeInstanceOf(InMemoryFinancialEventRepository);
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.FINANCIAL_EVENT_REPOSITORY =
      FinancialEventRepositoryStorage.MEMORY;

    const repository = await createFinancialEventRepository();

    expect(repository).toBeInstanceOf(InMemoryFinancialEventRepository);
  });

  it("creates a Supabase repository when explicitly selected", async () => {
    const supabaseClient = {
      from: vi.fn(),
    };

    const repository = await createFinancialEventRepository({
      storage: FinancialEventRepositoryStorage.SUPABASE,
      supabaseClient,
    });

    expect(repository).toBeInstanceOf(
      SupabaseFinancialEventRepository,
    );
  });

  it("rejects unsupported repository storage selections", async () => {
    await expect(
      createFinancialEventRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported financial event repository storage: unsupported",
    );
  });
});
