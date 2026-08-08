import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PropertyHVACApplication,
} from "../PropertyHVACApplication";

function input() {
  return {
    systemId: "system_1",
    eventType: "serviced",
    occurredAt:
      "2026-08-01T00:00:00.000Z",
    workPerformed:
      "Completed invoice work.",
    costCents: 95000,
    invoiceReference: "603",
  };
}

describe(
  "PropertyHVACApplication evidence recording",
  () => {
    it(
      "uses atomic recording when evidence is present",
      async () => {
        const saved = {
          id: "event_1",
        };

        const repository = {
          appendComponentEvent:
            vi.fn(),
          appendComponentEventWithEvidence:
            vi.fn()
              .mockResolvedValue(
                saved,
              ),
        };

        const application =
          new PropertyHVACApplication(
            repository,
            {
              idFactory:
                () => "event_1",
              clock:
                () =>
                  "2026-08-08T21:00:00.000Z",
            },
          );

        await expect(
          application.recordComponentEvent(
            input(),
            "owner_1",
            "property_evidence_1",
          ),
        ).resolves.toBe(
          saved,
        );

        expect(
          repository
            .appendComponentEventWithEvidence,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id:
              "property_hvac_event_event_1",
            systemId:
              "system_1",
            eventType:
              "serviced",
          }),
          "property_evidence_1",
          {
            ownerId:
              "owner_1",
          },
        );

        expect(
          repository
            .appendComponentEvent,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "preserves direct append behavior without evidence",
      async () => {
        const saved = {
          id: "event_1",
        };

        const repository = {
          appendComponentEvent:
            vi.fn()
              .mockResolvedValue(
                saved,
              ),
          appendComponentEventWithEvidence:
            vi.fn(),
        };

        const application =
          new PropertyHVACApplication(
            repository,
            {
              idFactory:
                () => "event_1",
              clock:
                () =>
                  "2026-08-08T21:00:00.000Z",
            },
          );

        await expect(
          application.recordComponentEvent(
            input(),
            "owner_1",
          ),
        ).resolves.toBe(
          saved,
        );

        expect(
          repository
            .appendComponentEvent,
        ).toHaveBeenCalled();

        expect(
          repository
            .appendComponentEventWithEvidence,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
