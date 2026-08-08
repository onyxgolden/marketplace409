const MEMORY_STORAGE =
  "memory";
const SUPABASE_STORAGE =
  "supabase";

export async function createPropertyHVACRepository(
  options = {},
) {
  const storage =
    options.storage ||
    process.env
      .PROPERTY_HVAC_REPOSITORY ||
    MEMORY_STORAGE;

  if (storage === MEMORY_STORAGE) {
    const {
      InMemoryPropertyHVACRepository,
    } = await import(
      "../../domains/property-hvac/" +
      "in-memory-property-hvac.repository.ts"
    );

    return new InMemoryPropertyHVACRepository();
  }

  if (
    storage === SUPABASE_STORAGE
  ) {
    const {
      SupabasePropertyHVACRepository,
    } = await import(
      "../../domains/property-hvac/" +
      "SupabasePropertyHVACRepository.js"
    );

    return new SupabasePropertyHVACRepository({
      supabaseClient:
        options.supabaseClient,
    });
  }

  throw new Error(
    "Unsupported property HVAC repository storage: " +
      storage,
  );
}

export function createLazyPropertyHVACRepository(
  options = {},
) {
  let repositoryPromise = null;

  function resolveRepository() {
    if (!repositoryPromise) {
      repositoryPromise =
        createPropertyHVACRepository(
          options,
        );
    }

    return repositoryPromise;
  }

  return Object.freeze({
    async saveSystem(
      system,
      context,
    ) {
      return (
        await resolveRepository()
      ).saveSystem(
        system,
        context,
      );
    },

    async findSystemById(
      systemId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findSystemById(
        systemId,
        ownerId,
      );
    },

    async findSystemsByProperty(
      propertyId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findSystemsByProperty(
        propertyId,
        ownerId,
      );
    },

    async saveComponent(
      component,
      context,
    ) {
      return (
        await resolveRepository()
      ).saveComponent(
        component,
        context,
      );
    },

    async findComponentById(
      componentId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findComponentById(
        componentId,
        ownerId,
      );
    },

    async findComponentsBySystem(
      systemId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findComponentsBySystem(
        systemId,
        ownerId,
      );
    },

    async appendComponentEvent(
      event,
      context,
    ) {
      return (
        await resolveRepository()
      ).appendComponentEvent(
        event,
        context,
      );
    },

    async findEventsBySystem(
      systemId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findEventsBySystem(
        systemId,
        ownerId,
      );
    },

    async findEventsByComponent(
      componentId,
      ownerId,
    ) {
      return (
        await resolveRepository()
      ).findEventsByComponent(
        componentId,
        ownerId,
      );
    },
  });
}

export const PropertyHVACRepositoryStorage =
  Object.freeze({
    MEMORY: MEMORY_STORAGE,
    SUPABASE: SUPABASE_STORAGE,
  });
