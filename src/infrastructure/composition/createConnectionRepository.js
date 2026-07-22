const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createConnectionRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.CONNECTION_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryConnectionRepository,
    } = await import(
      "../../domains/connection/" +
      "in-memory-connection.repository.ts"
    );

    return new InMemoryConnectionRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseConnectionRepository,
    } = await import(
      "../../domains/connection/" +
      "SupabaseConnectionRepository.js"
    );

    return new SupabaseConnectionRepository();
  }

  throw new Error(
    "Unsupported connection repository storage: " +
      storage,
  );
}

export function createLazyConnectionRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise =
        createConnectionRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(connection, context) {
      const repository = await resolveRepository();

      return repository.save(
        connection,
        context,
      );
    },

    async getById(id) {
      const repository = await resolveRepository();
      return repository.getById(id);
    },

    async getAll(context) {
      const repository = await resolveRepository();
      return repository.getAll(context);
    },
  });
}

export const ConnectionRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
