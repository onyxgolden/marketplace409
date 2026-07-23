const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createInstitutionReferenceRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.INSTITUTION_REFERENCE_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryInstitutionReferenceRepository,
    } = await import(
      "../../domains/connection/" +
      "in-memory-institution-reference.repository.ts"
    );

    return new InMemoryInstitutionReferenceRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseInstitutionReferenceRepository,
    } = await import(
      "../../domains/connection/" +
      "SupabaseInstitutionReferenceRepository.js"
    );

    return new SupabaseInstitutionReferenceRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported institution reference repository storage: " +
      storage,
  );
}

export function createLazyInstitutionReferenceRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise =
        createInstitutionReferenceRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(institutionReference, context) {
      const repository = await resolveRepository();

      return repository.save(
        institutionReference,
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

export const InstitutionReferenceRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
