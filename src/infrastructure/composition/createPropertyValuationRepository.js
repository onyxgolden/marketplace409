const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createPropertyValuationRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.PROPERTY_VALUATION_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryPropertyValuationRepository,
    } = await import(
      "../../domains/property-valuation/" +
      "in-memory-property-valuation.repository.ts"
    );

    return new InMemoryPropertyValuationRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabasePropertyValuationRepository,
    } = await import(
      "../../domains/property-valuation/" +
      "SupabasePropertyValuationRepository.js"
    );

    return new SupabasePropertyValuationRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported property valuation repository storage: " +
      storage,
  );
}

export function createLazyPropertyValuationRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createPropertyValuationRepository(
          options,
        );
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(valuation, context) {
      const repository =
        await resolveRepository();

      return repository.save(
        valuation,
        context,
      );
    },

    async saveMany(valuations, context) {
      const repository =
        await resolveRepository();

      return repository.saveMany(
        valuations,
        context,
      );
    },

    async findById(id, ownerId) {
      const repository =
        await resolveRepository();

      return repository.findById(
        id,
        ownerId,
      );
    },

  async deleteById(
    id,
    ownerId,
  ) {
    const repository =
      await resolveRepository();

    return repository.deleteById(
      id,
      ownerId,
    );
  },

    async findByProperty(
      propertyId,
      ownerId,
    ) {
      const repository =
        await resolveRepository();

      return repository.findByProperty(
        propertyId,
        ownerId,
      );
    },

    async findLatestByProperty(
      propertyId,
      ownerId,
    ) {
      const repository =
        await resolveRepository();

      return repository.findLatestByProperty(
        propertyId,
        ownerId,
      );
    },

    async findLatestByOwnerId(ownerId) {
      const repository =
        await resolveRepository();

      return repository.findLatestByOwnerId(
        ownerId,
      );
    },
  });
}

export const PropertyValuationRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
