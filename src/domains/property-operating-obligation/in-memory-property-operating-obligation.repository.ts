import type {
  PropertyOperatingObligationPersistenceContext,
  PropertyOperatingObligationQuery,
  PropertyOperatingObligationRepository,
} from "./property-operating-obligation.repository";

import type {
  PropertyOperatingObligation,
} from "./property-operating-obligation.types";

type StoredObligation = Readonly<{
  ownerId: string;
  obligation: PropertyOperatingObligation;
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

function optionalIdentifier(
  value: string | null | undefined,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).trim() || null;
}

function sortObligations(
  obligations:
    readonly PropertyOperatingObligation[],
): readonly PropertyOperatingObligation[] {
  return Object.freeze(
    [...obligations].sort(
      (left, right) =>
        (
          right.servicePeriodStart || ""
        ).localeCompare(
          left.servicePeriodStart || "",
        ) ||
        (
          right.paymentDate || ""
        ).localeCompare(
          left.paymentDate || "",
        ) ||
        right.createdAt.localeCompare(
          left.createdAt,
        ) ||
        left.id.localeCompare(right.id),
    ),
  );
}

export class InMemoryPropertyOperatingObligationRepository
  implements PropertyOperatingObligationRepository {
  private readonly obligationsById =
    new Map<string, StoredObligation>();

  async save(
    obligation: PropertyOperatingObligation,
    context:
      PropertyOperatingObligationPersistenceContext,
  ): Promise<PropertyOperatingObligation> {
    const ownerId = requireIdentifier(
      context?.ownerId,
      "Property operating obligation owner id is required.",
    );

    const existing =
      this.obligationsById.get(
        obligation.id,
      );

    if (
      existing &&
      existing.ownerId !== ownerId
    ) {
      throw new Error(
        "Property operating obligation owner mismatch.",
      );
    }

    this.obligationsById.set(
      obligation.id,
      Object.freeze({
        ownerId,
        obligation,
      }),
    );

    return obligation;
  }

  async saveMany(
    obligations:
      readonly PropertyOperatingObligation[],
    context:
      PropertyOperatingObligationPersistenceContext,
  ): Promise<
    readonly PropertyOperatingObligation[]
  > {
    const ownerId = requireIdentifier(
      context?.ownerId,
      "Property operating obligation owner id is required.",
    );

    for (const obligation of obligations) {
      const existing =
        this.obligationsById.get(
          obligation.id,
        );

      if (
        existing &&
        existing.ownerId !== ownerId
      ) {
        throw new Error(
          "Property operating obligation owner mismatch.",
        );
      }
    }

    for (const obligation of obligations) {
      await this.save(
        obligation,
        {
          ownerId,
        },
      );
    }

    return Object.freeze([
      ...obligations,
    ]);
  }

  async findById(
    id: string,
    ownerId: string,
  ): Promise<
    PropertyOperatingObligation | null
  > {
    const requiredId = requireIdentifier(
      id,
      "Property operating obligation id is required.",
    );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );
    const stored =
      this.obligationsById.get(
        requiredId,
      );

    if (
      !stored ||
      stored.ownerId !== requiredOwnerId
    ) {
      return null;
    }

    return stored.obligation;
  }

  async list(
    query:
      PropertyOperatingObligationQuery = {},
    ownerId: string,
  ): Promise<
    readonly PropertyOperatingObligation[]
  > {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );
    const propertyId =
      optionalIdentifier(
        query?.propertyId,
      );

    const obligations =
      Array.from(
        this.obligationsById.values(),
      )
        .filter(
          (stored) =>
            stored.ownerId ===
              requiredOwnerId,
        )
        .map(
          (stored) =>
            stored.obligation,
        )
        .filter(
          (obligation) =>
            !propertyId ||
            obligation.propertyId ===
              propertyId,
        )
        .filter(
          (obligation) =>
            !query?.scope ||
            obligation.scope ===
              query.scope,
        )
        .filter(
          (obligation) =>
            !query?.obligationType ||
            obligation.obligationType ===
              query.obligationType,
        )
        .filter(
          (obligation) =>
            !query?.status ||
            obligation.status ===
              query.status,
        )
        .filter(
          (obligation) =>
            !query?.recognitionStatus ||
            obligation.recognitionStatus ===
              query.recognitionStatus,
        )
        .filter(
          (obligation) =>
            !query?.unreconciledOnly ||
            !obligation
              .reconciledFinancialEventId,
        );

    return sortObligations(
      obligations,
    );
  }

  async findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<
    readonly PropertyOperatingObligation[]
  > {
    return this.list(
      {
        propertyId:
          requireIdentifier(
            propertyId,
            "Property operating obligation property id is required.",
          ),
        scope: "property",
      },
      ownerId,
    );
  }

  async deleteById(
    id: string,
    ownerId: string,
  ): Promise<
    PropertyOperatingObligation | null
  > {
    const obligation =
      await this.findById(
        id,
        ownerId,
      );

    if (!obligation) {
      return null;
    }

    this.obligationsById.delete(
      obligation.id,
    );

    return obligation;
  }
}
