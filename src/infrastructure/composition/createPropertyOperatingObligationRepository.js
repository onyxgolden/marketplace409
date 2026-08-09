const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createPropertyOperatingObligationRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env
      .PROPERTY_OPERATING_OBLIGATION_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryPropertyOperatingObligationRepository,
    } = await import(
      "../../domains/" +
      "property-operating-obligation/" +
      "in-memory-property-operating-obligation.repository.ts"
    );

    return new InMemoryPropertyOperatingObligationRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabasePropertyOperatingObligationRepository,
    } = await import(
      "../../domains/" +
      "property-operating-obligation/" +
      "SupabasePropertyOperatingObligationRepository.js"
    );

    return new SupabasePropertyOperatingObligationRepository({
      supabaseClient:
        options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported property operating obligation repository storage: " +
      storage,
  );
}

export function createLazyPropertyOperatingObligationRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createPropertyOperatingObligationRepository(
          options,
        );
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(
      obligation,
      context,
    ) {
      const repository =
        await resolveRepository();

      return repository.save(
        obligation,
        context,
      );
    },

    async saveMany(
      obligations,
      context,
    ) {
      const repository =
        await resolveRepository();

      return repository.saveMany(
        obligations,
        context,
      );
    },

    async findById(
      id,
      ownerId,
    ) {
      const repository =
        await resolveRepository();

      return repository.findById(
        id,
        ownerId,
      );
    },

    async list(
      query,
      ownerId,
    ) {
      const repository =
        await resolveRepository();

      return repository.list(
        query,
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
  });
}

export const PropertyOperatingObligationRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
