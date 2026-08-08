import type {
  HVACPersistenceContext,
  PropertyHVACRepository,
} from "./property-hvac.repository";

import type {
  HVACComponent,
  HVACComponentEvent,
  HVACSystem,
} from "./property-hvac.types";

type StoredSystem = Readonly<{
  ownerId: string;
  system: HVACSystem;
}>;

type StoredComponent = Readonly<{
  ownerId: string;
  component: HVACComponent;
}>;

type StoredEvent = Readonly<{
  ownerId: string;
  event: HVACComponentEvent;
}>;

function requireIdentifier(
  value: string,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function key(
  ownerId: string,
  id: string,
): string {
  return `${ownerId}:${id}`;
}

function freezeArray<T>(
  values: readonly T[],
): readonly T[] {
  return Object.freeze([
    ...values,
  ]);
}

export class InMemoryPropertyHVACRepository
  implements PropertyHVACRepository {
  private readonly systems =
    new Map<string, StoredSystem>();

  private readonly components =
    new Map<string, StoredComponent>();

  private readonly events =
    new Map<string, StoredEvent>();

  async saveSystem(
    system: HVACSystem,
    context: HVACPersistenceContext,
  ): Promise<HVACSystem> {
    const ownerId =
      requireIdentifier(
        context?.ownerId,
        "HVAC owner id is required.",
      );

    this.systems.set(
      key(
        ownerId,
        system.id,
      ),
      Object.freeze({
        ownerId,
        system,
      }),
    );

    return system;
  }

  async findSystemById(
    systemId: string,
    ownerId: string,
  ): Promise<HVACSystem | null> {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return (
      this.systems.get(
        key(
          requiredOwnerId,
          requireIdentifier(
            systemId,
            "HVAC system id is required.",
          ),
        ),
      )?.system ?? null
    );
  }

  async findSystemsByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<readonly HVACSystem[]> {
    const requiredPropertyId =
      requireIdentifier(
        propertyId,
        "HVAC property id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return freezeArray(
      Array.from(
        this.systems.values(),
      )
        .filter(
          (stored) =>
            stored.ownerId ===
              requiredOwnerId &&
            stored.system.propertyId ===
              requiredPropertyId,
        )
        .map(
          (stored) =>
            stored.system,
        )
        .sort(
          (left, right) =>
            left.name.localeCompare(
              right.name,
            ) ||
            left.id.localeCompare(
              right.id,
            ),
        ),
    );
  }

  async saveComponent(
    component: HVACComponent,
    context: HVACPersistenceContext,
  ): Promise<HVACComponent> {
    const ownerId =
      requireIdentifier(
        context?.ownerId,
        "HVAC owner id is required.",
      );

    const system =
      await this.findSystemById(
        component.systemId,
        ownerId,
      );

    if (!system) {
      throw new Error(
        "HVAC component requires an owner-scoped system.",
      );
    }

    this.components.set(
      key(
        ownerId,
        component.id,
      ),
      Object.freeze({
        ownerId,
        component,
      }),
    );

    return component;
  }

  async findComponentById(
    componentId: string,
    ownerId: string,
  ): Promise<HVACComponent | null> {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return (
      this.components.get(
        key(
          requiredOwnerId,
          requireIdentifier(
            componentId,
            "HVAC component id is required.",
          ),
        ),
      )?.component ?? null
    );
  }

  async findComponentsBySystem(
    systemId: string,
    ownerId: string,
  ): Promise<readonly HVACComponent[]> {
    const requiredSystemId =
      requireIdentifier(
        systemId,
        "HVAC system id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return freezeArray(
      Array.from(
        this.components.values(),
      )
        .filter(
          (stored) =>
            stored.ownerId ===
              requiredOwnerId &&
            stored.component.systemId ===
              requiredSystemId,
        )
        .map(
          (stored) =>
            stored.component,
        )
        .sort(
          (left, right) =>
            left.name.localeCompare(
              right.name,
            ) ||
            left.id.localeCompare(
              right.id,
            ),
        ),
    );
  }

  async appendComponentEvent(
    event: HVACComponentEvent,
    context: HVACPersistenceContext,
  ): Promise<HVACComponentEvent> {
    const ownerId =
      requireIdentifier(
        context?.ownerId,
        "HVAC owner id is required.",
      );

    const system =
      await this.findSystemById(
        event.systemId,
        ownerId,
      );

    if (!system) {
      throw new Error(
        "HVAC component event requires an owner-scoped system.",
      );
    }

    if (
      event.componentId !== null
    ) {
      const component =
        await this.findComponentById(
          event.componentId,
          ownerId,
        );

      if (
        !component ||
        component.systemId !==
          event.systemId
      ) {
        throw new Error(
          "HVAC component event requires a component from the same owner-scoped system.",
        );
      }
    }

    const eventKey =
      key(
        ownerId,
        event.id,
      );

    if (
      this.events.has(eventKey)
    ) {
      throw new Error(
        "HVAC component event id already exists.",
      );
    }

    this.events.set(
      eventKey,
      Object.freeze({
        ownerId,
        event,
      }),
    );

    return event;
  }

  async findEventsBySystem(
    systemId: string,
    ownerId: string,
  ): Promise<readonly HVACComponentEvent[]> {
    const requiredSystemId =
      requireIdentifier(
        systemId,
        "HVAC system id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return this.sortedEvents(
      (stored) =>
        stored.ownerId ===
          requiredOwnerId &&
        stored.event.systemId ===
          requiredSystemId,
    );
  }

  async findEventsByComponent(
    componentId: string,
    ownerId: string,
  ): Promise<readonly HVACComponentEvent[]> {
    const requiredComponentId =
      requireIdentifier(
        componentId,
        "HVAC component id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    return this.sortedEvents(
      (stored) =>
        stored.ownerId ===
          requiredOwnerId &&
        stored.event.componentId ===
          requiredComponentId,
    );
  }

  private sortedEvents(
    predicate:
      (stored: StoredEvent) =>
        boolean,
  ): readonly HVACComponentEvent[] {
    return freezeArray(
      Array.from(
        this.events.values(),
      )
        .filter(predicate)
        .map(
          (stored) =>
            stored.event,
        )
        .sort(
          (left, right) =>
            right.occurredAt.localeCompare(
              left.occurredAt,
            ) ||
            right.createdAt.localeCompare(
              left.createdAt,
            ) ||
            left.id.localeCompare(
              right.id,
            ),
        ),
    );
  }
}
