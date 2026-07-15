const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createAccountBalanceRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.ACCOUNT_BALANCE_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryAccountBalanceRepository,
    } = await import(
      "../../domains/account-balance/" +
      "in-memory-account-balance.repository.ts"
    );

    return new InMemoryAccountBalanceRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseAccountBalanceRepository,
    } = await import(
      "../../domains/account-balance/" +
      "SupabaseAccountBalanceRepository.js"
    );

    return new SupabaseAccountBalanceRepository();
  }

  throw new Error(
    "Unsupported account balance repository storage: " +
      storage,
  );
}

export function createLazyAccountBalanceRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createAccountBalanceRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(balance, context) {
      const repository =
        await resolveRepository();

      return repository.save(balance, context);
    },

    async saveMany(balances, context) {
      const repository =
        await resolveRepository();

      return repository.saveMany(
        balances,
        context,
      );
    },

    async findByFinancialAccount(
      financialAccountId,
    ) {
      const repository =
        await resolveRepository();

      return repository.findByFinancialAccount(
        financialAccountId,
      );
    },

    async findLatestByFinancialAccount(
      financialAccountId,
    ) {
      const repository =
        await resolveRepository();

      return repository
        .findLatestByFinancialAccount(
          financialAccountId,
        );
    },

    async findByConnection(connectionId) {
      const repository =
        await resolveRepository();

      return repository.findByConnection(
        connectionId,
      );
    },
  });
}

export const AccountBalanceRepositoryStorage = Object.freeze({
  MEMORY: MEMORY_STORAGE,
  SUPABASE: SUPABASE_STORAGE,
});
