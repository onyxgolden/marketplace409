import { describe, expect, it } from "vitest";

import { createRentalUnit } from "../rental-unit.types";

function buildUnit(overrides = {}) {
  return {
    id: "unit_kent_main",
    propertyId: "4800-kent-ave",
    label: "Main residence",
    status: "preparing" as const,
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1450,
    availableAt: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    notes: "Remodel in progress.",
    ...overrides,
  };
}

describe("RentalUnit", () => {
  it("creates an immutable property-scoped unit", () => {
    const unit = createRentalUnit(buildUnit({
      label: "  Main residence  ",
      notes: "  Remodel in progress.  ",
    }));

    expect(unit.label).toBe("Main residence");
    expect(unit.notes).toBe("Remodel in progress.");
    expect(Object.isFrozen(unit)).toBe(true);
  });

  it.each(["preparing", "available", "occupied", "inactive"] as const)(
    "supports %s units",
    (status) => {
      expect(createRentalUnit(buildUnit({ status })).status).toBe(status);
    },
  );

  it.each([
    ["id", { id: "" }],
    ["property", { propertyId: "" }],
    ["label", { label: "" }],
    ["bedrooms", { bedrooms: -1 }],
    ["bathrooms", { bathrooms: Number.NaN }],
    ["square feet", { squareFeet: -1 }],
    ["availability", { availableAt: "not-a-date" }],
    ["creation", { createdAt: "not-a-date" }],
  ])("rejects an invalid %s", (_label, overrides) => {
    expect(() => createRentalUnit(buildUnit(overrides))).toThrow();
  });

  it("rejects unsupported statuses", () => {
    expect(() => createRentalUnit(buildUnit({ status: "unknown" }) as never))
      .toThrow("Rental unit requires a supported status.");
  });
});
