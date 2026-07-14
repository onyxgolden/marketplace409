const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createFinancialEventRepository(options = {}) {
  const storage =
    options.storage ||
    process.env.FINANCIAL_EVENT_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const { InMemoryFinancialEventRepository } = await import(
      "../../domains/financial-event/InMemoryFinancialEventRepository.js"
    );

    return new InMemoryFinancialEventRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const { SupabaseFinancialEventRepository } = await import(
      "../../domains/financial-event/SupabaseFinancialEventRepository.js"
    );

    return new SupabaseFinancialEventRepository();
  }

  throw new Error(
    `Unsupported financial event repository storage: ${storage}`
  );
}

export const FinancialEventRepositoryStorage = Object.freeze({
  MEMORY: MEMORY_STORAGE,
  SUPABASE: SUPABASE_STORAGE,
});
