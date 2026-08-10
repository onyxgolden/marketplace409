import { describe, expect, it } from "vitest";
import { InMemoryPropertyHVACRepository } from "../in-memory-property-hvac.repository";
import type { HVACSystemReplacementCommand } from "../property-hvac-system-replacement.types";

const oldSystem = {
  id: "old", propertyId: "property_1", name: "Old", systemType: "split_system",
  energySource: "electric", refrigerantType: null, tonnage: null,
  efficiencyRating: null, manufacturer: null, modelNumber: null, serialNumber: null,
  installedAt: null, estimatedAgeYears: null, location: null, thermostatType: null,
  warrantyExpiration: null, status: "active", condition: "failed", notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const newSystem = {
  ...oldSystem, id: "new", name: "New", status: "active", condition: "good",
  createdAt: "2026-08-10T00:00:00.000Z",
} as const;

const failureEvent = {
  id: "failure", systemId: "old", componentId: null, eventType: "failed",
  occurredAt: "2026-08-09T00:00:00.000Z", failureSymptoms: "Failed",
  workPerformed: null, costCents: null, vendorName: null, invoiceReference: null,
  photoReferences: [], componentActions: [], notes: null,
  createdAt: "2026-08-10T00:00:00.000Z",
} as const;

const installationEvent = {
  ...failureEvent, id: "installation", systemId: "new", eventType: "installed",
  occurredAt: "2026-08-10T00:00:00.000Z", failureSymptoms: null,
} as const;

function command(overrides: Partial<HVACSystemReplacementCommand> = {}): HVACSystemReplacementCommand {
  return {
    transition: {
      id: "replacement", propertyId: "property_1", predecessorSystemId: "old",
      replacementSystemId: "new", failureEventId: "failure",
      installationEventId: "installation", evidenceId: "evidence",
      occurredAt: "2026-08-10T00:00:00.000Z", createdAt: "2026-08-10T00:00:00.000Z",
    },
    predecessorSystem: { ...oldSystem, status: "replaced", condition: "failed" },
    replacementSystem: newSystem,
    failureEvent,
    installationEvent,
    initialComponents: [{
      id: "compressor", systemId: "new", componentType: "compressor", name: "Compressor",
      manufacturer: null, modelNumber: null, partNumber: null, serialNumber: null,
      installedAt: null, removedAt: null, estimatedAgeYears: null, condition: "good",
      status: "installed", estimatedReplacementCostCents: null, vendorName: null,
      invoiceReference: null, warrantyExpiration: null, notes: null,
      createdAt: "2026-08-10T00:00:00.000Z",
    }],
    ...overrides,
  };
}

async function repository() {
  const repository = new InMemoryPropertyHVACRepository();
  await repository.saveSystem(oldSystem, { ownerId: "owner_1" });
  return repository;
}

describe("in-memory HVAC system replacement", () => {
  it("atomically replaces the old system and appends both histories", async () => {
    const repo = await repository();
    const result = await repo.replaceSystem(command(), { ownerId: "owner_1" });
    expect(result.created).toBe(true);
    await expect(repo.findSystemById("old", "owner_1"))
      .resolves.toMatchObject({ status: "replaced", condition: "failed" });
    await expect(repo.findSystemById("new", "owner_1")).resolves.toEqual(newSystem);
    await expect(repo.findEventsBySystem("old", "owner_1"))
      .resolves.toEqual([failureEvent]);
    await expect(repo.findEventsBySystem("new", "owner_1"))
      .resolves.toEqual([installationEvent]);
    await expect(repo.findComponentsBySystem("new", "owner_1"))
      .resolves.toHaveLength(1);
  });

  it("makes an identical committed retry idempotent", async () => {
    const repo = await repository();
    expect((await repo.replaceSystem(command(), { ownerId: "owner_1" })).created).toBe(true);
    expect((await repo.replaceSystem(command(), { ownerId: "owner_1" })).created).toBe(false);
    await expect(repo.findEventsBySystem("new", "owner_1")).resolves.toHaveLength(1);
  });

  it("rejects a changed retry", async () => {
    const repo = await repository();
    await repo.replaceSystem(command(), { ownerId: "owner_1" });
    await expect(repo.replaceSystem(command({
      transition: { ...command().transition, evidenceId: "other" },
    }), { ownerId: "owner_1" })).rejects.toThrow(
      "HVAC replacement id already exists with different facts.",
    );
  });

  it("rolls back completely when validation fails", async () => {
    const repo = await repository();
    const invalid = command({
      initialComponents: [
        command().initialComponents[0],
        command().initialComponents[0],
      ],
    });
    await expect(repo.replaceSystem(invalid, { ownerId: "owner_1" }))
      .rejects.toThrow("HVAC replacement components require unique identities");
    await expect(repo.findSystemById("old", "owner_1"))
      .resolves.toEqual(oldSystem);
    await expect(repo.findSystemById("new", "owner_1")).resolves.toBeNull();
    await expect(repo.findEventsBySystem("old", "owner_1")).resolves.toEqual([]);
  });

  it("does not cross owner scope", async () => {
    const repo = await repository();
    await expect(repo.replaceSystem(command(), { ownerId: "owner_2" }))
      .rejects.toThrow("owner-scoped predecessor system");
  });
});
