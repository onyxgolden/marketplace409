const SUPABASE_STORAGE = "supabase";
const MEMORY_STORAGE = "memory";

export async function createFinancialSnapshotRepository(options = {}) {
  const storage =
    options.storage ||
    process.env.FINANCIAL_SNAPSHOT_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const { FinancialSnapshotRepository } = await import(
      "../../domains/ledger/snapshots/FinancialSnapshotRepository.js"
    );

    return new FinancialSnapshotRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const { SupabaseFinancialSnapshotRepository } = await import(
      "../../domains/ledger/snapshots/SupabaseFinancialSnapshotRepository.js"
    );

    return new SupabaseFinancialSnapshotRepository();
  }

  throw new Error(
    `Unsupported financial snapshot repository storage: ${storage}`
  );
}

export const FinancialSnapshotRepositoryStorage = Object.freeze({
  MEMORY: MEMORY_STORAGE,
  SUPABASE: SUPABASE_STORAGE,
});
