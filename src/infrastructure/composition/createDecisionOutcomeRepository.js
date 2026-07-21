const MEMORY_STORAGE = "memory";
const SUPABASE_STORAGE = "supabase";

export async function createDecisionOutcomeRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env.DECISION_OUTCOME_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryDecisionOutcomeRepository,
    } = await import(
      "../../domains/decision/" +
      "InMemoryDecisionOutcomeRepository.js"
    );

    return new InMemoryDecisionOutcomeRepository(
      options.initialEvaluations,
    );
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabaseDecisionOutcomeRepository,
    } = await import(
      "../../domains/decision/" +
      "SupabaseDecisionOutcomeRepository.js"
    );

    return new SupabaseDecisionOutcomeRepository({
      supabaseClient: options.supabaseClient,
      ownerId: options.ownerId,
    });
  }

  throw new Error(
    "Unsupported decision outcome repository storage: " +
      storage,
  );
}

export const DecisionOutcomeRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
