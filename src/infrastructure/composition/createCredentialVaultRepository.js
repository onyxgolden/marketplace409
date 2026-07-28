const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createCredentialVaultRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.CREDENTIAL_VAULT_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryCredentialVaultRepository,
    } = await import(
      "../../domains/connection/" +
      "in-memory-credential-vault.repository.ts"
    );

    return new InMemoryCredentialVaultRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseCredentialVaultRepository,
    } = await import(
      "../../domains/connection/" +
      "SupabaseCredentialVaultRepository.js"
    );

    return new SupabaseCredentialVaultRepository({
      supabaseClient:
        options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported credential vault repository storage: " +
      storage,
  );
}

export function createLazyCredentialVaultRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (repositoryPromise === null) {
      repositoryPromise =
        createCredentialVaultRepository(options);
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async store(ownerId, vaultReference, secret) {
      const repository =
        await resolveRepository();

      return repository.store(
        ownerId,
        vaultReference,
        secret,
      );
    },

    async retrieve(ownerId, vaultReference) {
      const repository =
        await resolveRepository();

      return repository.retrieve(
        ownerId,
        vaultReference,
      );
    },

    async delete(ownerId, vaultReference) {
      const repository =
        await resolveRepository();

      return repository.delete(
        ownerId,
        vaultReference,
      );
    },

    async exists(ownerId, vaultReference) {
      const repository =
        await resolveRepository();

      return repository.exists(
        ownerId,
        vaultReference,
      );
    },
  });
}

export const CredentialVaultRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
