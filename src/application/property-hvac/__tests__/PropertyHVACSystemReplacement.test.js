import { describe, expect, it, vi } from "vitest";
import { PropertyHVACApplication } from "../PropertyHVACApplication";

function predecessor(overrides = {}) {
  return {
    id: "system_old", propertyId: "property_1", name: "Old HVAC",
    systemType: "split_system", energySource: "electric",
    refrigerantType: "R-22", tonnage: 3, efficiencyRating: "10 SEER",
    manufacturer: "Old Co", modelNumber: "OLD-1", serialNumber: "OLD-SERIAL",
    installedAt: "2005-01-01T00:00:00.000Z", estimatedAgeYears: 21,
    location: "Attic", thermostatType: "digital", warrantyExpiration: null,
    status: "active", condition: "failed", notes: null,
    createdAt: "2026-08-08T00:00:00.000Z", ...overrides,
  };
}

function input(overrides = {}) {
  return {
    id: "replacement_1", predecessorSystemId: "system_old",
    evidenceId: "evidence_1", occurredAt: "2026-08-10T00:00:00.000Z",
    replacementSystem: {
      id: "system_new", propertyId: "property_1", name: "New HVAC",
      systemType: "heat_pump", energySource: "electric", condition: "good",
      installedAt: "2026-08-10T00:00:00.000Z",
    },
    failureEvent: {
      id: "event_failure", occurredAt: "2026-08-09T00:00:00.000Z",
      failureSymptoms: "Compressor failed.",
    },
    installationEvent: {
      id: "event_installation", occurredAt: "2026-08-10T00:00:00.000Z",
      workPerformed: "Installed replacement system.", costCents: 850000,
      vendorName: "ABC HVAC", invoiceReference: "INV-1",
    },
    initialComponents: [{
      id: "component_new", componentType: "compressor", name: "Compressor",
      condition: "good", status: "installed",
    }],
    ...overrides,
  };
}

function application(system = predecessor()) {
  const replaceSystem = vi.fn(async (command) => Object.freeze({ ...command, created: true }));
  const repository = {
    findSystemById: vi.fn().mockResolvedValue(system), replaceSystem,
  };
  return {
    repository, replaceSystem,
    application: new PropertyHVACApplication(repository, {
      clock: () => "2026-08-10T12:00:00.000Z",
      idFactory: () => "generated",
    }),
  };
}

describe("PropertyHVACApplication system replacement", () => {
  it("builds one canonical atomic replacement command", async () => {
    const fixture = application();
    const result = await fixture.application.replaceSystem(input(), " owner_1 ");

    expect(fixture.repository.findSystemById).toHaveBeenCalledWith("system_old", "owner_1");
    expect(fixture.replaceSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: expect.objectContaining({
          id: "replacement_1", propertyId: "property_1",
          predecessorSystemId: "system_old", replacementSystemId: "system_new",
          failureEventId: "event_failure", installationEventId: "event_installation",
          evidenceId: "evidence_1",
        }),
        predecessorSystem: expect.objectContaining({ status: "replaced", condition: "failed" }),
        replacementSystem: expect.objectContaining({ id: "system_new", propertyId: "property_1", status: "active" }),
        failureEvent: expect.objectContaining({ systemId: "system_old", componentId: null, eventType: "failed" }),
        installationEvent: expect.objectContaining({ systemId: "system_new", componentId: null, eventType: "installed" }),
        initialComponents: [expect.objectContaining({ id: "component_new", systemId: "system_new" })],
      }),
      { ownerId: "owner_1" },
    );
    expect(result.created).toBe(true);
  });

  it("rejects a replacement for a different property", async () => {
    const fixture = application();
    await expect(fixture.application.replaceSystem(input({
      replacementSystem: { ...input().replacementSystem, propertyId: "property_2" },
    }), "owner_1")).rejects.toThrow("Replacement HVAC system must belong to the predecessor property.");
    expect(fixture.replaceSystem).not.toHaveBeenCalled();
  });

  it("rejects absent and retired predecessors", async () => {
    await expect(application(null).application.replaceSystem(input(), "owner_1"))
      .rejects.toThrow("Predecessor HVAC system was not found.");
    await expect(application(predecessor({ status: "replaced" })).application.replaceSystem(input(), "owner_1"))
      .rejects.toThrow("Only a current HVAC system can be replaced.");
  });

  it("requires an atomic repository capability", async () => {
    const app = new PropertyHVACApplication({ findSystemById: vi.fn() });
    await expect(app.replaceSystem(input(), "owner_1"))
      .rejects.toThrow("HVAC repository does not support atomic system replacement.");
  });
});
