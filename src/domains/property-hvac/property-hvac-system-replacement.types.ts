import type {
  HVACComponent,
  HVACComponentEvent,
  HVACSystem,
} from "./property-hvac.types";

export type HVACSystemReplacement =
  Readonly<{
    id: string;
    propertyId: string;
    predecessorSystemId: string;
    replacementSystemId: string;
    failureEventId: string;
    installationEventId: string;
    evidenceId: string | null;
    occurredAt: string;
    createdAt: string;
  }>;

export type HVACSystemReplacementCommand =
  Readonly<{
    transition:
      HVACSystemReplacement;
    predecessorSystem:
      HVACSystem;
    replacementSystem:
      HVACSystem;
    failureEvent:
      HVACComponentEvent;
    installationEvent:
      HVACComponentEvent;
    initialComponents:
      readonly HVACComponent[];
  }>;

export type HVACSystemReplacementResult =
  Readonly<{
    transition:
      HVACSystemReplacement;
    predecessorSystem:
      HVACSystem;
    replacementSystem:
      HVACSystem;
    failureEvent:
      HVACComponentEvent;
    installationEvent:
      HVACComponentEvent;
    initialComponents:
      readonly HVACComponent[];
    created: boolean;
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

function requireTimestamp(
  value: string,
  message: string,
): string {
  const required =
    requireIdentifier(
      value,
      message,
    );

  if (
    Number.isNaN(
      Date.parse(required),
    )
  ) {
    throw new Error(message);
  }

  return required;
}

export function createHVACSystemReplacement(
  replacement:
    HVACSystemReplacement,
): HVACSystemReplacement {
  const predecessorSystemId =
    requireIdentifier(
      replacement
        .predecessorSystemId,
      "Predecessor HVAC system id is required.",
    );

  const replacementSystemId =
    requireIdentifier(
      replacement
        .replacementSystemId,
      "Replacement HVAC system id is required.",
    );

  if (
    predecessorSystemId ===
      replacementSystemId
  ) {
    throw new Error(
      "Replacement HVAC system must be separate from its predecessor.",
    );
  }

  return Object.freeze({
    id:
      requireIdentifier(
        replacement.id,
        "HVAC replacement id is required.",
      ),
    propertyId:
      requireIdentifier(
        replacement.propertyId,
        "HVAC replacement property id is required.",
      ),
    predecessorSystemId,
    replacementSystemId,
    failureEventId:
      requireIdentifier(
        replacement.failureEventId,
        "HVAC failure event id is required.",
      ),
    installationEventId:
      requireIdentifier(
        replacement
          .installationEventId,
        "HVAC installation event id is required.",
      ),
    evidenceId:
      replacement.evidenceId
        ?.trim() || null,
    occurredAt:
      requireTimestamp(
        replacement.occurredAt,
        "HVAC replacement occurrence date must be valid.",
      ),
    createdAt:
      requireTimestamp(
        replacement.createdAt,
        "HVAC replacement creation date must be valid.",
      ),
  });
}
