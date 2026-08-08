const SUPABASE_STORAGE =
  "supabase";

export async function createPropertyEvidenceRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env
      .PROPERTY_EVIDENCE_REPOSITORY ||
    SUPABASE_STORAGE;

  if (
    storage === SUPABASE_STORAGE
  ) {
    const {
      SupabasePropertyEvidenceRepository,
    } = await import(
      "../../domains/property-evidence/" +
      "SupabasePropertyEvidenceRepository.js"
    );

    return new SupabasePropertyEvidenceRepository({
      supabaseClient:
        options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported property evidence repository storage: " +
      storage,
  );
}

export const PropertyEvidenceRepositoryStorage =
  Object.freeze({
    SUPABASE:
      SUPABASE_STORAGE,
  });
