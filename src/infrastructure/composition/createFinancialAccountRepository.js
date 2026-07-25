const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createFinancialAccountRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.FINANCIAL_ACCOUNT_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryFinancialAccountRepository,
    } = await import(
      "../../domains/financial-account/" +
      "in-memory-financial-account.repository.ts"
    );

    return new InMemoryFinancialAccountRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseFinancialAccountRepository,
    } = await import(
      "../../domains/financial-account/" +
      "SupabaseFinancialAccountRepository.js"
    );

    return new SupabaseFinancialAccountRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported financial account repository storage: " +
      storage,
  );
}

export function createLazyFinancialAccountRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise =
        createFinancialAccountRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(account, context) {
      const repository = await resolveRepository();
      return repository.save(account, context);
    },

    async saveMany(accounts, context) {
      const repository = await resolveRepository();
      return repository.saveMany(accounts, context);
    },

    async findById(id) {
      const repository = await resolveRepository();
      return repository.findById(id);
    },

    async findByOwnerId(ownerId) {
      const repository = await resolveRepository();
      return repository.findByOwnerId(ownerId);
    },

    async findByConnection(connectionId) {
      const repository = await resolveRepository();
      return repository.findByConnection(connectionId);
    },

    async findByProviderAccountId(
      provider,
      providerAccountId,
    ) {
      const repository = await resolveRepository();

      return repository.findByProviderAccountId(
        provider,
        providerAccountId,
      );
    },
  });
}

export const FinancialAccountRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
