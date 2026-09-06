import { describe, expect, it } from "vitest";
import { PROJECT_TEMPLATES } from "./schedulingBoardState";
import { STARTER_RESOURCE_SETS, starterResourceSetForTemplate } from "./schedulingStarterResources";

const RESOURCE_TYPES = ["labor", "nonlabor", "material"];

describe("schedulingStarterResources", () => {
  it("gives every project template its own starter resource set", () => {
    for (const template of PROJECT_TEMPLATES) {
      expect(STARTER_RESOURCE_SETS[template.id]?.length).toBeGreaterThan(0);
    }
  });

  it("gives every starter resource a name, a valid type, and a non-negative rate", () => {
    for (const set of Object.values(STARTER_RESOURCE_SETS)) {
      for (const resource of set) {
        expect(resource.name.length).toBeGreaterThan(0);
        expect(RESOURCE_TYPES).toContain(resource.resourceType);
        expect(resource.maxUnitsPerDay).toBeGreaterThan(0);
        expect(resource.stdRate).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every material resource a unit of measure, and no other type one", () => {
    for (const set of Object.values(STARTER_RESOURCE_SETS)) {
      for (const resource of set) {
        if (resource.resourceType === "material") expect(resource.unitOfMeasure).toBeTruthy();
        else expect(resource.unitOfMeasure).toBeFalsy();
      }
    }
  });

  it("has no duplicate resource names within a single set", () => {
    for (const set of Object.values(STARTER_RESOURCE_SETS)) {
      const names = set.map((resource) => resource.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("falls back to the standard set for an unknown template id", () => {
    expect(starterResourceSetForTemplate("does_not_exist")).toBe(STARTER_RESOURCE_SETS.standard);
  });

  it("resolves a known template id to its own set", () => {
    expect(starterResourceSetForTemplate("capital")).toBe(STARTER_RESOURCE_SETS.capital);
  });
});
