import { describe, expect, it } from "vitest";
import { InMemoryRentalUnitRepository } from "../in-memory-rental-unit.repository";
import { mapRentalUnitRowToRentalUnit, mapRentalUnitToRow } from "../rental-unit.mapper";
import { createRentalUnit } from "../rental-unit.types";

function unit(id = "unit_1") {
  return createRentalUnit({
    id,
    propertyId: "4800-kent-ave",
    label: "Main residence",
    status: "preparing",
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1450,
    availableAt: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    notes: null,
  });
}

describe("rental unit persistence", () => {
  it("round trips owner-scoped rows", () => {
    const row = mapRentalUnitToRow(unit(), "owner_1");
    expect(row.owner_id).toBe("owner_1");
    expect(mapRentalUnitRowToRentalUnit(row)).toEqual(unit());
  });

  it("isolates units by owner", async () => {
    const repository = new InMemoryRentalUnitRepository();
    await repository.save(unit(), { ownerId: "owner_1" });
    await expect(repository.findById("unit_1", "owner_1")).resolves.toEqual(unit());
    await expect(repository.findById("unit_1", "owner_2")).resolves.toBeNull();
  });

  it("lists only units for the selected property", async () => {
    const repository = new InMemoryRentalUnitRepository();
    await repository.save(unit("unit_2"), { ownerId: "owner_1" });
    await repository.save(unit("unit_1"), { ownerId: "owner_1" });
    await expect(repository.findByProperty("4800-kent-ave", "owner_1"))
      .resolves.toHaveLength(2);
  });

  it("requires owner scope", async () => {
    const repository = new InMemoryRentalUnitRepository();
    await expect(repository.save(unit(), {} as never)).rejects.toThrow("Rental unit owner id is required.");
    expect(() => mapRentalUnitToRow(unit(), "")).toThrow("Rental unit owner id is required.");
  });
});
