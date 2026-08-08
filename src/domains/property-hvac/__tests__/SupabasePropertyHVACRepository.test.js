import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import {
  SupabasePropertyHVACRepository,
} from "../SupabasePropertyHVACRepository.js";

const query = {
  upsert: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

const client = {
  from: vi.fn(
    () => query,
  ),
};

function systemRow(
  overrides = {},
) {
  return {
    owner_id: "owner_1",
    id: "system_1",
    property_id:
      "1214-wagner",
    name: "Main HVAC",
    system_type:
      "split_system",
    energy_source:
      "electric",
    refrigerant_type:
      "R-410A",
    tonnage: 3,
    efficiency_rating:
      "14 SEER",
    manufacturer: null,
    model_number: null,
    serial_number: null,
    installed_at: null,
    estimated_age_years:
      null,
    location: null,
    thermostat_type: null,
    warranty_expiration:
      null,
    status: "active",
    condition:
      "serviceable",
    notes: null,
    created_at:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function system() {
  return {
    id: "system_1",
    propertyId:
      "1214-wagner",
    name: "Main HVAC",
    systemType:
      "split_system",
    energySource:
      "electric",
    refrigerantType:
      "R-410A",
    tonnage: 3,
    efficiencyRating:
      "14 SEER",
    manufacturer: null,
    modelNumber: null,
    serialNumber: null,
    installedAt: null,
    estimatedAgeYears:
      null,
    location: null,
    thermostatType: null,
    warrantyExpiration:
      null,
    status: "active",
    condition:
      "serviceable",
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
  };
}

function componentRow() {
  return {
    owner_id: "owner_1",
    id: "component_1",
    system_id: "system_1",
    component_type:
      "capacitor",
    name: "Run capacitor",
    manufacturer: null,
    model_number: null,
    part_number: null,
    serial_number: null,
    installed_at: null,
    removed_at: null,
    estimated_age_years:
      null,
    condition: "good",
    status: "installed",
    estimated_replacement_cost_cents:
      35000,
    vendor_name: null,
    invoice_reference:
      null,
    warranty_expiration:
      null,
    notes: null,
    created_at:
      "2026-08-08T00:00:00.000Z",
  };
}

function component() {
  return {
    id: "component_1",
    systemId: "system_1",
    componentType:
      "capacitor",
    name: "Run capacitor",
    manufacturer: null,
    modelNumber: null,
    partNumber: null,
    serialNumber: null,
    installedAt: null,
    removedAt: null,
    estimatedAgeYears:
      null,
    condition: "good",
    status: "installed",
    estimatedReplacementCostCents:
      35000,
    vendorName: null,
    invoiceReference:
      null,
    warrantyExpiration:
      null,
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
  };
}

function eventRow() {
  return {
    owner_id: "owner_1",
    id: "event_1",
    system_id: "system_1",
    component_id:
      "component_1",
    event_type: "repaired",
    occurred_at:
      "2026-08-01T00:00:00.000Z",
    failure_symptoms:
      "Would not start",
    work_performed:
      "Replaced capacitor",
    cost_cents: 35000,
    vendor_name:
      "ABC HVAC",
    invoice_reference:
      "invoice-1",
    photo_references: [],
    component_actions: [],
    notes: null,
    created_at:
      "2026-08-08T00:00:00.000Z",
  };
}

function event() {
  return {
    id: "event_1",
    systemId: "system_1",
    componentId:
      "component_1",
    eventType: "repaired",
    occurredAt:
      "2026-08-01T00:00:00.000Z",
    failureSymptoms:
      "Would not start",
    workPerformed:
      "Replaced capacitor",
    costCents: 35000,
    vendorName:
      "ABC HVAC",
    invoiceReference:
      "invoice-1",
    photoReferences: [],
    componentActions: [],
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
  };
}

describe(
  "SupabasePropertyHVACRepository",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      for (
        const method of
          Object.values(query)
      ) {
        method.mockReturnValue(
          query,
        );
      }
    });

    it(
      "upserts current owner-scoped systems",
      async () => {
        query.single
          .mockResolvedValue({
            data: systemRow(),
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        const result =
          await repository.saveSystem(
            system(),
            {
              ownerId:
                "owner_1",
            },
          );

        expect(
          client.from,
        ).toHaveBeenCalledWith(
          "property_hvac_systems",
        );

        expect(
          query.upsert,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            owner_id:
              "owner_1",
            id: "system_1",
          }),
          {
            onConflict:
              "owner_id,id",
          },
        );

        expect(result).toEqual(
          system(),
        );
      },
    );

    it(
      "upserts current owner-scoped components",
      async () => {
        query.single
          .mockResolvedValue({
            data:
              componentRow(),
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        await expect(
          repository.saveComponent(
            component(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).resolves.toEqual(
          component(),
        );

        expect(
          query.upsert,
        ).toHaveBeenCalled();
      },
    );

    it(
      "inserts events without upsert mutation",
      async () => {
        query.single
          .mockResolvedValue({
            data: eventRow(),
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        await expect(
          repository.appendComponentEvent(
            event(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).resolves.toEqual(
          event(),
        );

        expect(
          query.insert,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            owner_id:
              "owner_1",
            id: "event_1",
          }),
        );

        expect(
          query.upsert,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "loads systems by owner and property",
      async () => {
        query.order
          .mockResolvedValue({
            data: [
              systemRow(),
            ],
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        const result =
          await repository.findSystemsByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "owner_id",
          "owner_1",
        );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "property_id",
          "1214-wagner",
        );

        expect(result).toEqual([
          system(),
        ]);

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    it(
      "loads component history in descending occurrence order",
      async () => {
        query.order
          .mockResolvedValue({
            data: [
              eventRow(),
            ],
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        const result =
          await repository.findEventsByComponent(
            "component_1",
            "owner_1",
          );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "component_id",
          "component_1",
        );

        expect(
          query.order,
        ).toHaveBeenCalledWith(
          "occurred_at",
          {
            ascending: false,
          },
        );

        expect(result).toEqual([
          event(),
        ]);
      },
    );

    it(
      "returns null for absent identities",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data: null,
            error: null,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        await expect(
          repository.findSystemById(
            "system_1",
            "owner_1",
          ),
        ).resolves.toBeNull();

        await expect(
          repository.findComponentById(
            "component_1",
            "owner_1",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "requires owner scope before persistence",
      async () => {
        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        await expect(
          repository.saveSystem(
            system(),
            {},
          ),
        ).rejects.toThrow(
          "HVAC owner id is required.",
        );

        expect(
          query.upsert,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "propagates Supabase failures",
      async () => {
        const failure =
          new Error(
            "HVAC query failed",
          );

        query.order
          .mockResolvedValue({
            data: null,
            error: failure,
          });

        const repository =
          new SupabasePropertyHVACRepository({
            supabaseClient:
              client,
          });

        await expect(
          repository.findSystemsByProperty(
            "property_1",
            "owner_1",
          ),
        ).rejects.toBe(
          failure,
        );
      },
    );
  },
);
