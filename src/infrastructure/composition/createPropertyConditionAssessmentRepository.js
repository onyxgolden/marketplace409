const SUPABASE_STORAGE =
  "supabase";
const MEMORY_STORAGE =
  "memory";

export async function createPropertyConditionAssessmentRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env
      .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryPropertyConditionAssessmentRepository,
    } = await import(
      "../../domains/" +
      "property-condition-assessment/" +
      "in-memory-property-condition-assessment.repository.ts"
    );

    return new InMemoryPropertyConditionAssessmentRepository();
  }

  if (storage === SUPABASE_STORAGE) {
    const {
      SupabasePropertyConditionAssessmentRepository,
    } = await import(
      "../../domains/" +
      "property-condition-assessment/" +
      "SupabasePropertyConditionAssessmentRepository.js"
    );

    return new SupabasePropertyConditionAssessmentRepository({
      supabaseClient:
        options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported property condition assessment repository storage: " +
      storage,
  );
}

export function createLazyPropertyConditionAssessmentRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createPropertyConditionAssessmentRepository(
          options,
        );
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async save(
      assessment,
      context,
    ) {
      const repository =
        await resolveRepository();

      return repository.save(
        assessment,
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

    async findLatestByOwnerId(
      ownerId,
    ) {
      const repository =
        await resolveRepository();

      return repository.findLatestByOwnerId(
        ownerId,
      );
    },
  });
}

export const PropertyConditionAssessmentRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
