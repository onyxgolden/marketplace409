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
    throw new Error(
      "Supabase decision outcome repository is not implemented",
    );
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
