import {
  createHVACSystemReplacement,
} from "./property-hvac-system-replacement.types";

import type {
  HVACSystemReplacement,
} from "./property-hvac-system-replacement.types";

export type HVACSystemReplacementRow =
  Readonly<{
    owner_id: string;
    id: string;
    property_id: string;
    predecessor_system_id: string;
    replacement_system_id: string;
    failure_event_id: string;
    installation_event_id: string;
    evidence_id: string | null;
    occurred_at: string;
    created_at: string;
  }>;

function requireOwnerId(
  ownerId: string,
): string {
  if (
    typeof ownerId !== "string" ||
    ownerId.trim() === ""
  ) {
    throw new Error(
      "HVAC owner id is required.",
    );
  }

  return ownerId.trim();
}

export function mapHVACSystemReplacementToRow(
  replacement:
    HVACSystemReplacement,
  ownerId: string,
): HVACSystemReplacementRow {
  return Object.freeze({
    owner_id:
      requireOwnerId(ownerId),
    id: replacement.id,
    property_id:
      replacement.propertyId,
    predecessor_system_id:
      replacement
        .predecessorSystemId,
    replacement_system_id:
      replacement
        .replacementSystemId,
    failure_event_id:
      replacement.failureEventId,
    installation_event_id:
      replacement
        .installationEventId,
    evidence_id:
      replacement.evidenceId,
    occurred_at:
      replacement.occurredAt,
    created_at:
      replacement.createdAt,
  });
}

export function mapHVACSystemReplacementRowToDomain(
  row: HVACSystemReplacementRow,
): HVACSystemReplacement {
  return createHVACSystemReplacement({
    id: row.id,
    propertyId:
      row.property_id,
    predecessorSystemId:
      row.predecessor_system_id,
    replacementSystemId:
      row.replacement_system_id,
    failureEventId:
      row.failure_event_id,
    installationEventId:
      row.installation_event_id,
    evidenceId:
      row.evidence_id,
    occurredAt:
      row.occurred_at,
    createdAt:
      row.created_at,
  });
}
