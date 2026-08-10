import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createHVACSystemReplacement,
} from "../property-hvac-system-replacement.types";

function replacement(
  overrides = {},
) {
  return {
    id:
      "property_hvac_replacement_1",
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
    ...overrides,
  };
}

describe(
  "HVAC system replacement lifecycle",
  () => {
    it(
      "creates an immutable linked transition",
      () => {
        const transition =
          createHVACSystemReplacement(
            replacement(),
          );

        expect(transition)
          .toEqual(
            replacement(),
          );

        expect(
          Object.isFrozen(
            transition,
          ),
        ).toBe(true);
      },
    );

    it(
      "normalizes identifiers and optional evidence",
      () => {
        const transition =
          createHVACSystemReplacement(
            replacement({
              id:
                " replacement_1 ",
              evidenceId: "   ",
            }),
          );

        expect(
          transition.id,
        ).toBe(
          "replacement_1",
        );

        expect(
          transition.evidenceId,
        ).toBeNull();
      },
    );

    it(
      "requires separate old and new system identities",
      () => {
        expect(() =>
          createHVACSystemReplacement(
            replacement({
              replacementSystemId:
                "system_old",
            }),
          ),
        ).toThrow(
          "Replacement HVAC system must be separate from its predecessor.",
        );
      },
    );

    it.each([
      [
        "id",
        "",
        "HVAC replacement id is required.",
      ],
      [
        "propertyId",
        "",
        "HVAC replacement property id is required.",
      ],
      [
        "predecessorSystemId",
        "",
        "Predecessor HVAC system id is required.",
      ],
      [
        "replacementSystemId",
        "",
        "Replacement HVAC system id is required.",
      ],
      [
        "failureEventId",
        "",
        "HVAC failure event id is required.",
      ],
      [
        "installationEventId",
        "",
        "HVAC installation event id is required.",
      ],
    ])(
      "requires %s",
      (
        field,
        value,
        message,
      ) => {
        expect(() =>
          createHVACSystemReplacement(
            replacement({
              [field]: value,
            }),
          ),
        ).toThrow(message);
      },
    );

    it.each([
      "occurredAt",
      "createdAt",
    ])(
      "requires valid %s",
      (field) => {
        expect(() =>
          createHVACSystemReplacement(
            replacement({
              [field]:
                "not-a-date",
            }),
          ),
        ).toThrow(
          /date must be valid/,
        );
      },
    );
  },
);
