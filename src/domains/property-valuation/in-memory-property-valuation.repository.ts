import type {
  PropertyValuationPersistenceContext,
  PropertyValuationRepository,
} from "./property-valuation.repository";

import type {
  PropertyValuation,
} from "./property-valuation.types";

type StoredPropertyValuation = Readonly<{
  ownerId: string;
  valuation: PropertyValuation;
}>;

function requireIdentifier(
  value: string,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(message);
  }

  return value.trim();
}

export class InMemoryPropertyValuationRepository
  implements PropertyValuationRepository {
  private readonly valuationsById =
    new Map<string, StoredPropertyValuation>();

  async save(
    valuation: PropertyValuation,
    context: PropertyValuationPersistenceContext,
  ): Promise<PropertyValuation> {
    const ownerId = requireIdentifier(
      context?.ownerId,
      "Property valuation owner id is required.",
    );

    this.valuationsById.set(
      valuation.id,
      Object.freeze({
        ownerId,
        valuation,
      }),
    );

    return valuation;
  }

  async saveMany(
    valuations: readonly PropertyValuation[],
    context: PropertyValuationPersistenceContext,
  ): Promise<readonly PropertyValuation[]> {
    for (const valuation of valuations) {
      await this.save(valuation, context);
    }

    return Object.freeze([...valuations]);
  }

  async findById(
    id: string,
    ownerId: string,
  ): Promise<PropertyValuation | null> {
    const stored = this.valuationsById.get(
      requireIdentifier(
        id,
        "Property valuation id is required.",
      ),
    );

    if (
      !stored ||
      stored.ownerId !==
        requireIdentifier(
          ownerId,
          "Property valuation owner id is required.",
        )
    ) {
      return null;
    }

    return stored.valuation;
  }

  async findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<readonly PropertyValuation[]> {
    const requiredPropertyId = requireIdentifier(
      propertyId,
      "Property valuation property id is required.",
    );
    const requiredOwnerId = requireIdentifier(
      ownerId,
      "Property valuation owner id is required.",
    );

    return Object.freeze(
      Array.from(this.valuationsById.values())
        .filter(
          (stored) =>
            stored.ownerId === requiredOwnerId &&
            stored.valuation.propertyId ===
              requiredPropertyId,
        )
        .map((stored) => stored.valuation)
        .sort(
          (left, right) =>
            right.effectiveAt.localeCompare(
              left.effectiveAt,
            ) ||
            right.createdAt.localeCompare(
              left.createdAt,
            ) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async findLatestByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<PropertyValuation | null> {
    const valuations = await this.findByProperty(
      propertyId,
      ownerId,
    );

    return valuations[0] ?? null;
  }

  async findLatestByOwnerId(
    ownerId: string,
  ): Promise<readonly PropertyValuation[]> {
    const requiredOwnerId = requireIdentifier(
      ownerId,
      "Property valuation owner id is required.",
    );
    const latestByProperty =
      new Map<string, PropertyValuation>();

    const valuations = Array.from(
      this.valuationsById.values(),
    )
      .filter(
        (stored) =>
          stored.ownerId === requiredOwnerId,
      )
      .map((stored) => stored.valuation)
      .sort(
        (left, right) =>
          left.propertyId.localeCompare(
            right.propertyId,
          ) ||
          right.effectiveAt.localeCompare(
            left.effectiveAt,
          ) ||
          right.createdAt.localeCompare(
            left.createdAt,
          ) ||
          left.id.localeCompare(right.id),
      );

    for (const valuation of valuations) {
      if (
        !latestByProperty.has(
          valuation.propertyId,
        )
      ) {
        latestByProperty.set(
          valuation.propertyId,
          valuation,
        );
      }
    }

    return Object.freeze(
      Array.from(latestByProperty.values()),
    );
  }
}
