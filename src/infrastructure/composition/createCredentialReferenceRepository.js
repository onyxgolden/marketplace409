const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createCredentialReferenceRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.CREDENTIAL_REFERENCE_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryCredentialReferenceRepository,
    } = await import(
      "../../domains/connection/" +
      "in-memory-credential-reference.repository.ts"
    );

    return new InMemoryCredentialReferenceRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseCredentialReferenceRepository,
    } = await import(
      "../../domains/connection/" +
      "SupabaseCredentialReferenceRepository.js"
    );

    return new SupabaseCredentialReferenceRepository({
      supabaseClient: options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported credential reference repository storage: " +
      storage,
  );
}

export function createLazyCredentialReferenceRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise =
        createCredentialReferenceRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(credentialReference, context) {
      const repository = await resolveRepository();

      return repository.save(
        credentialReference,
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

export const CredentialReferenceRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
