import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { SupabasePropertyHVACRepository } from "../SupabasePropertyHVACRepository.js";

const systemRow = (id, status, condition) => ({
  owner_id: "owner_1", id, property_id: "property_1", name: id,
  system_type: "split_system", energy_source: "electric", refrigerant_type: null,
  tonnage: null, efficiency_rating: null, manufacturer: null, model_number: null,
  serial_number: null, installed_at: null, estimated_age_years: null, location: null,
  thermostat_type: null, warranty_expiration: null, status, condition, notes: null,
  created_at: "2026-08-10T00:00:00.000Z",
});

const eventRow = (id, systemId, eventType) => ({
  owner_id: "owner_1", id, system_id: systemId, component_id: null,
  event_type: eventType, occurred_at: "2026-08-10T00:00:00.000Z",
  failure_symptoms: null, work_performed: null, cost_cents: null,
  vendor_name: null, invoice_reference: null, photo_references: [],
  component_actions: [], notes: null, created_at: "2026-08-10T00:00:00.000Z",
});

const componentRow = {
  owner_id: "owner_1", id: "component", system_id: "new",
  component_type: "compressor", name: "Compressor", manufacturer: null,
  model_number: null, part_number: null, serial_number: null, installed_at: null,
  removed_at: null, estimated_age_years: null, condition: "good", status: "installed",
  estimated_replacement_cost_cents: null, vendor_name: null, invoice_reference: null,
  warranty_expiration: null, notes: null, created_at: "2026-08-10T00:00:00.000Z",
};

const transitionRow = {
  owner_id: "owner_1", id: "replacement", property_id: "property_1",
  predecessor_system_id: "old", replacement_system_id: "new",
  failure_event_id: "failure", installation_event_id: "installation",
  evidence_id: "evidence", occurred_at: "2026-08-10T00:00:00.000Z",
  created_at: "2026-08-10T00:00:00.000Z",
};

const toSystem = (row) => ({
  id: row.id, propertyId: row.property_id, name: row.name, systemType: row.system_type,
  energySource: row.energy_source, refrigerantType: row.refrigerant_type,
  tonnage: row.tonnage, efficiencyRating: row.efficiency_rating,
  manufacturer: row.manufacturer, modelNumber: row.model_number,
  serialNumber: row.serial_number, installedAt: row.installed_at,
  estimatedAgeYears: row.estimated_age_years, location: row.location,
  thermostatType: row.thermostat_type, warrantyExpiration: row.warranty_expiration,
  status: row.status, condition: row.condition, notes: row.notes, createdAt: row.created_at,
});

const toEvent = (row) => ({
  id: row.id, systemId: row.system_id, componentId: null, eventType: row.event_type,
  occurredAt: row.occurred_at, failureSymptoms: null, workPerformed: null,
  costCents: null, vendorName: null, invoiceReference: null, photoReferences: [],
  componentActions: [], notes: null, createdAt: row.created_at,
});

const command = {
  transition: {
    id: "replacement", propertyId: "property_1", predecessorSystemId: "old",
    replacementSystemId: "new", failureEventId: "failure",
    installationEventId: "installation", evidenceId: "evidence",
    occurredAt: transitionRow.occurred_at, createdAt: transitionRow.created_at,
  },
  predecessorSystem: toSystem(systemRow("old", "replaced", "failed")),
  replacementSystem: toSystem(systemRow("new", "active", "good")),
  failureEvent: toEvent(eventRow("failure", "old", "failed")),
  installationEvent: toEvent(eventRow("installation", "new", "installed")),
  initialComponents: [{
    id: "component", systemId: "new", componentType: "compressor", name: "Compressor",
    manufacturer: null, modelNumber: null, partNumber: null, serialNumber: null,
    installedAt: null, removedAt: null, estimatedAgeYears: null, condition: "good",
    status: "installed", estimatedReplacementCostCents: null, vendorName: null,
    invoiceReference: null, warrantyExpiration: null, notes: null,
    createdAt: componentRow.created_at,
  }],
};

describe("Supabase HVAC system replacement", () => {
  it("executes the complete lifecycle through one RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        transition: transitionRow,
        predecessor_system: systemRow("old", "replaced", "failed"),
        replacement_system: systemRow("new", "active", "good"),
        failure_event: eventRow("failure", "old", "failed"),
        installation_event: eventRow("installation", "new", "installed"),
        initial_components: [componentRow], created: true,
      }, error: null,
    });
    const repository = new SupabasePropertyHVACRepository({ supabaseClient: { rpc } });
    const result = await repository.replaceSystem(command, { ownerId: "owner_1" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_property_hvac_system", {
      p_owner_id: "owner_1", p_transition: transitionRow,
      p_predecessor_system: systemRow("old", "replaced", "failed"),
      p_replacement_system: systemRow("new", "active", "good"),
      p_failure_event: eventRow("failure", "old", "failed"),
      p_installation_event: eventRow("installation", "new", "installed"),
      p_initial_components: [componentRow],
    });
    expect(result).toMatchObject({ created: true, transition: command.transition });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.initialComponents)).toBe(true);
  });

  it("propagates RPC failures", async () => {
    const failure = new Error("Atomic replacement failed");
    const repository = new SupabasePropertyHVACRepository({
      supabaseClient: { rpc: vi.fn().mockResolvedValue({ data: null, error: failure }) },
    });
    await expect(repository.replaceSystem(command, { ownerId: "owner_1" }))
      .rejects.toBe(failure);
  });

  it("rejects incomplete RPC results", async () => {
    const repository = new SupabasePropertyHVACRepository({
      supabaseClient: { rpc: vi.fn().mockResolvedValue({ data: { transition: transitionRow }, error: null }) },
    });
    await expect(repository.replaceSystem(command, { ownerId: "owner_1" }))
      .rejects.toThrow("did not return a complete lifecycle result");
  });
});
