import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "@/lib/supabase",
  () => ({
    supabase: {},
  }),
);

import {
  SupabasePropertyHVACRepository,
} from "../SupabasePropertyHVACRepository.js";

function event() {
  return {
    id: "event_1",
    systemId: "system_1",
    componentId: null,
    eventType: "serviced",
    occurredAt:
      "2026-08-01T00:00:00.000Z",
    failureSymptoms:
      "System was flat.",
    workPerformed:
      "Completed invoice work.",
    costCents: 95000,
    vendorName:
      "Arctic Air",
    invoiceReference: "603",
    photoReferences: [],
    componentActions: [],
    notes: null,
    createdAt:
      "2026-08-08T21:00:00.000Z",
  };
}

function eventRow() {
  return {
    owner_id: "owner_1",
    id: "event_1",
    system_id: "system_1",
    component_id: null,
    event_type: "serviced",
    occurred_at:
      "2026-08-01T00:00:00.000Z",
    failure_symptoms:
      "System was flat.",
    work_performed:
      "Completed invoice work.",
    cost_cents: 95000,
    vendor_name:
      "Arctic Air",
    invoice_reference: "603",
    photo_references: [],
    component_actions: [],
    notes: null,
    created_at:
      "2026-08-08T21:00:00.000Z",
  };
}

describe(
  "SupabasePropertyHVACRepository evidence recording",
  () => {
    it(
      "calls the atomic event and evidence RPC",
      async () => {
        const rpc = vi.fn()
          .mockResolvedValue({
            data: {
              event:
                eventRow(),
              evidence_id:
                "property_evidence_1",
              created: true,
            },
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient: {
              rpc,
            },
          });

        await expect(
          repository
            .appendComponentEventWithEvidence(
              event(),
              "property_evidence_1",
              {
                ownerId:
                  "owner_1",
              },
            ),
        ).resolves.toEqual(
          event(),
        );

        expect(
          rpc,
        ).toHaveBeenCalledWith(
          "record_property_hvac_event_with_evidence",
          {
            p_owner_id:
              "owner_1",
            p_event:
              eventRow(),
            p_evidence_id:
              "property_evidence_1",
          },
        );
      },
    );

    it(
      "propagates RPC failures",
      async () => {
        const failure =
          new Error(
            "Atomic recording failed.",
          );

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient: {
              rpc:
                vi.fn()
                  .mockResolvedValue({
                    data: null,
                    error:
                      failure,
                  }),
            },
          });

        await expect(
          repository
            .appendComponentEventWithEvidence(
              event(),
              "property_evidence_1",
              {
                ownerId:
                  "owner_1",
              },
            ),
        ).rejects.toBe(
          failure,
        );
      },
    );

    it(
      "requires evidence identity before RPC execution",
      async () => {
        const rpc = vi.fn();

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient: {
              rpc,
            },
          });

        await expect(
          repository
            .appendComponentEventWithEvidence(
              event(),
              "",
              {
                ownerId:
                  "owner_1",
              },
            ),
        ).rejects.toThrow(
          "Property evidence id is required.",
        );

        expect(
          rpc,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
