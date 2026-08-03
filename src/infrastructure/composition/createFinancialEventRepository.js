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

    return new SupabaseFinancialEventRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    `Unsupported financial event repository storage: ${storage}`
  );
}


export function createLazyFinancialEventRepository(options = {}) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise = createFinancialEventRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async saveMany(events) {
      const repository = await resolveRepository();

      return repository.saveMany(events);
    },
  });
}

export const FinancialEventRepositoryStorage = Object.freeze({
  MEMORY: MEMORY_STORAGE,
  SUPABASE: SUPABASE_STORAGE,
});
