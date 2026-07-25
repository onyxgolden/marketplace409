const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createConnectionExecutionHistoryRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.CONNECTION_EXECUTION_HISTORY_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryConnectionExecutionHistoryRepository,
    } = await import(
      "../../domains/connection-execution-history/" +
      "in-memory-connection-execution-history.repository.ts"
    );

    return new InMemoryConnectionExecutionHistoryRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseConnectionExecutionHistoryRepository,
    } = await import(
      "../../domains/connection-execution-history/" +
      "SupabaseConnectionExecutionHistoryRepository.js"
    );

    return new SupabaseConnectionExecutionHistoryRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported connection execution history repository storage: " +
      storage,
  );
}

export function createLazyConnectionExecutionHistoryRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createConnectionExecutionHistoryRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(history, context) {
      const repository =
        await resolveRepository();

      return repository.save(history, context);
    },

    async findByConnectionId(connectionId, context) {
      const repository =
        await resolveRepository();

      return repository.findByConnectionId(
        connectionId,
        context,
      );
    },

    async findByOwnerId(context) {
      const repository =
        await resolveRepository();

      return repository.findByOwnerId(context);
    },

    async findRecentByOwnerId(limit, context) {
      const repository =
        await resolveRepository();

      return repository.findRecentByOwnerId(
        limit,
        context,
      );
    },
  });
}

export const ConnectionExecutionHistoryRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
