import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapHVACSystemReplacementRowToDomain,
  mapHVACSystemReplacementToRow,
} from "../property-hvac-system-replacement.mapper";

const domain = {
  id: "replacement_1",
  propertyId:
    "1214-wagner",
  predecessorSystemId:
    "system_old",
  replacementSystemId:
    "system_new",
  failureEventId:
    "event_failure",
  installationEventId:
    "event_installation",
  evidenceId:
    "property_evidence_1",
  occurredAt:
    "2026-08-10T00:00:00.000Z",
  createdAt:
    "2026-08-10T12:00:00.000Z",
};

const row = {
  owner_id: "owner_1",
  id: "replacement_1",
  property_id:
    "1214-wagner",
  predecessor_system_id:
    "system_old",
  replacement_system_id:
    "system_new",
  failure_event_id:
    "event_failure",
  installation_event_id:
    "event_installation",
  evidence_id:
    "property_evidence_1",
  occurred_at:
    "2026-08-10T00:00:00.000Z",
  created_at:
    "2026-08-10T12:00:00.000Z",
};

describe(
  "HVAC system replacement mapper",
  () => {
    it(
      "maps a domain transition to an owner-scoped row",
      () => {
        const result =
          mapHVACSystemReplacementToRow(
            domain,
            " owner_1 ",
          );

        expect(result).toEqual(
          row,
        );

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    it(
      "maps a persistence row to an immutable domain transition",
      () => {
        const result =
          mapHVACSystemReplacementRowToDomain(
            row,
          );

        expect(result).toEqual(
          domain,
        );

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    it(
      "preserves a null evidence relationship",
      () => {
        const result =
          mapHVACSystemReplacementRowToDomain({
            ...row,
            evidence_id: null,
          });

        expect(
          result.evidenceId,
        ).toBeNull();
      },
    );

    it(
      "requires owner authority when mapping to persistence",
      () => {
        expect(() =>
          mapHVACSystemReplacementToRow(
            domain,
            "",
          ),
        ).toThrow(
          "HVAC owner id is required.",
        );
      },
    );
  },
);
