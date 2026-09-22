import { beforeEach, describe, expect, it } from "vitest";
import {
  addWall,
  createEmptyDesign,
  renameDesign,
  validateDesign,
} from "./designerDocument";
import {
  addLevel,
  createHomeProject,
  ensureHomeProject,
  getCurrentDesign,
  getCurrentLevel,
  getLevel,
  HOME_PROJECT_VERSION,
  isHomeProject,
  levelCount,
  parseHomeProject,
  projectFromDesign,
  removeLevel,
  renameLevel,
  renameProject,
  resetHomeProjectIds,
  serializeHomeProject,
  setCurrentLevel,
  updateBuildingMetadata,
  updateLevelDesign,
  validateHomeProject,
} from "./homeProject";


beforeEach(() => {
  resetHomeProjectIds();
});

describe("createHomeProject", () => {
  it("creates a one-level project with sane defaults", () => {
    const project = createHomeProject("My house");
    expect(project.version).toBe(HOME_PROJECT_VERSION);
    expect(project.name).toBe("My house");
    expect(project.units).toBe("in");
    expect(project.levels).toHaveLength(1);
    expect(project.levels[0].name).toBe("Level 1");
    expect(project.currentLevelId).toBe(project.levels[0].id);
    expect(validateDesign(project.levels[0].design)).toEqual([]);
    expect(project.building).toEqual({ address: "", city: "", state: "", zip: "", notes: "" });
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("defaults a blank name and accepts building metadata", () => {
    const project = createHomeProject("", {
      building: { address: "123 Main St", city: "Beaumont", state: "TX" },
    });
    expect(project.name).toBe("Untitled project");
    expect(project.building.address).toBe("123 Main St");
    expect(project.building.city).toBe("Beaumont");
    expect(project.building.zip).toBe("");
  });

  it("rejects bad units and bad building field types", () => {
    expect(() => createHomeProject("x", { units: "" })).toThrow("units");
    expect(() => createHomeProject("x", { building: { zip: 77701 } })).toThrow(
      "building.zip must be a string",
    );
  });
});

describe("projectFromDesign / ensureHomeProject", () => {
  it("wraps a legacy design as Level 1 without mutating it", () => {
    const design = addWall(createEmptyDesign("Kitchen"), { x: 0, y: 0 }, { x: 120, y: 0 });
    const snapshot = JSON.parse(JSON.stringify(design));
    const project = projectFromDesign(design, "Reno");
    expect(project.levels).toHaveLength(1);
    expect(project.levels[0].name).toBe("Level 1");
    expect(project.levels[0].design).toBe(design);
    expect(getCurrentDesign(project).walls).toHaveLength(1);
    expect(design).toEqual(snapshot);
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("falls back to the design name when no project name is given", () => {
    const design = renameDesign(createEmptyDesign(), "Sunroom");
    expect(projectFromDesign(design).name).toBe("Sunroom");
  });

  it("refuses to wrap an invalid design", () => {
    expect(() => projectFromDesign({ version: 999 }, "bad")).toThrow();
  });

  it("ensureHomeProject passes valid projects through and migrates designs", () => {
    const project = createHomeProject("A");
    expect(ensureHomeProject(project, "ignored")).toBe(project);
    const migrated = ensureHomeProject(createEmptyDesign("B"), "B project");
    expect(isHomeProject(migrated)).toBe(true);
    expect(migrated.name).toBe("B project");
  });

  it("isHomeProject distinguishes projects from designs", () => {
    expect(isHomeProject(createHomeProject("A"))).toBe(true);
    expect(isHomeProject(createEmptyDesign())).toBe(false);
    expect(isHomeProject(null)).toBe(false);
    expect(isHomeProject({ version: HOME_PROJECT_VERSION })).toBe(false);
  });

  it("ensureHomeProject throws on a corrupt stored project", () => {
    const corrupt = { version: HOME_PROJECT_VERSION, levels: [] };
    expect(() => ensureHomeProject(corrupt, "x")).toThrow("Stored project is invalid");
  });

  it("ensureHomeProject opens an empty project for null/undefined designs instead of throwing", () => {
    for (const value of [null, undefined]) {
      const project = ensureHomeProject(value, "Recovered");
      expect(isHomeProject(project)).toBe(true);
      expect(project.name).toBe("Recovered");
      expect(project.levels).toHaveLength(1);
      expect(validateHomeProject(project)).toEqual([]);
    }
  });
});

describe("levels", () => {
  it("adds, renames, and selects levels", () => {
    let project = createHomeProject("Two-story");
    const firstId = project.currentLevelId;
    project = addLevel(project, "Level 2");
    expect(levelCount(project)).toBe(2);
    expect(project.currentLevelId).toBe(firstId); // current level unchanged
    const secondId = project.levels[1].id;
    expect(secondId).not.toBe(firstId);

    project = setCurrentLevel(project, secondId);
    expect(getCurrentLevel(project).id).toBe(secondId);

    project = renameLevel(project, secondId, "Second floor");
    expect(getLevel(project, secondId).name).toBe("Second floor");
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("defaults blank level names to the next Level N", () => {
    let project = createHomeProject("A");
    project = addLevel(project, "   ");
    expect(project.levels[1].name).toBe("Level 2");
  });

  it("addLevel never reuses an id after a reload resets the id counter", () => {
    let project = createHomeProject("Reload");
    project = addLevel(project, "Level 2");
    project = addLevel(project, "Level 3");
    const json = serializeHomeProject(project);
    resetHomeProjectIds(); // simulate a page reload: the module counter restarts at 0
    const restored = parseHomeProject(json);
    const updated = addLevel(restored, "Level 4");
    const ids = updated.levels.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(updated.levels[3].id).toBe("level_4");
    expect(validateHomeProject(updated)).toEqual([]);
  });

  it("throws on unknown level ids", () => {
    const project = createHomeProject("A");
    expect(() => getLevel(project, "nope")).toThrow("Unknown level nope");
    expect(() => setCurrentLevel(project, "nope")).toThrow("Unknown level");
    expect(() => renameLevel(project, "nope", "x")).toThrow("Unknown level");
    expect(() => removeLevel(project, "nope")).toThrow("Unknown level");
    expect(() => updateLevelDesign(project, "nope", (d) => d)).toThrow("Unknown level");
  });

  it("rejects blank level and project names", () => {
    const project = createHomeProject("A");
    expect(() => renameLevel(project, project.currentLevelId, " ")).toThrow("non-empty");
    expect(() => renameProject(project, "")).toThrow("non-empty");
  });

  it("removes levels but never the last one", () => {
    let project = createHomeProject("A");
    project = addLevel(project, "Level 2");
    const secondId = project.levels[1].id;
    project = setCurrentLevel(project, secondId);
    project = removeLevel(project, secondId);
    expect(levelCount(project)).toBe(1);
    // Removing the current level moves current to the first remaining level.
    expect(project.currentLevelId).toBe(project.levels[0].id);
    expect(() => removeLevel(project, project.currentLevelId)).toThrow(
      "Cannot remove the last level",
    );
  });

  it("setCurrentLevel is a no-op when already current", () => {
    const project = createHomeProject("A");
    expect(setCurrentLevel(project, project.currentLevelId)).toBe(project);
  });
});

describe("updateLevelDesign", () => {
  it("applies designer ops to one level only", () => {
    let project = createHomeProject("A");
    project = addLevel(project, "Level 2");
    const firstId = project.levels[0].id;
    const secondId = project.levels[1].id;

    project = updateLevelDesign(project, secondId, (design) =>
      addWall(design, { x: 0, y: 0 }, { x: 96, y: 0 }),
    );
    expect(getLevel(project, secondId).design.walls).toHaveLength(1);
    expect(getLevel(project, firstId).design.walls).toHaveLength(0);
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("rejects a non-function updater and an invalid result", () => {
    const project = createHomeProject("A");
    const id = project.currentLevelId;
    expect(() => updateLevelDesign(project, id, null)).toThrow("updater must be a function");
    expect(() => updateLevelDesign(project, id, () => ({ version: 999 }))).toThrow(
      "Updated level design is invalid",
    );
  });

  it("never mutates the input project", () => {
    const project = createHomeProject("A");
    const snapshot = serializeHomeProject(project);
    updateLevelDesign(project, project.currentLevelId, (design) =>
      addWall(design, { x: 0, y: 0 }, { x: 10, y: 0 }),
    );
    expect(serializeHomeProject(project)).toBe(snapshot);
  });
});

describe("updateBuildingMetadata", () => {
  it("merges known fields and ignores unknown ones", () => {
    let project = createHomeProject("A");
    project = updateBuildingMetadata(project, {
      address: "123 Main St",
      notes: " pier and beam ",
      bogus: "ignored",
    });
    expect(project.building.address).toBe("123 Main St");
    expect(project.building.notes).toBe(" pier and beam ");
    expect(project.building).not.toHaveProperty("bogus");
  });

  it("rejects non-string fields and non-object input", () => {
    const project = createHomeProject("A");
    expect(() => updateBuildingMetadata(project, { city: 42 })).toThrow(
      "building.city must be a string",
    );
    expect(() => updateBuildingMetadata(project, null)).toThrow("must be an object");
  });
});

describe("validateHomeProject", () => {
  it("flags structural problems without throwing", () => {
    expect(validateHomeProject(null)).toEqual(["Not a home project (bad version)."]);
    expect(validateHomeProject({ version: HOME_PROJECT_VERSION, levels: [] })).toEqual([
      "A home project must have at least one level.",
    ]);

    const dup = createHomeProject("A");
    dup.levels = [dup.levels[0], { ...dup.levels[0] }];
    expect(validateHomeProject(dup)).toContain(
      `Duplicate level id ${dup.levels[0].id}.`,
    );

    const dangling = createHomeProject("A");
    dangling.currentLevelId = "missing";
    expect(validateHomeProject(dangling)).toContain(
      "currentLevelId does not resolve to a level.",
    );
  });
});

describe("serialize/parse round-trip", () => {
  it("round-trips a project with edits on multiple levels", () => {
    let project = createHomeProject("Round trip", {
      building: { address: "1 Forge Way" },
    });
    project = addLevel(project, "Level 2");
    project = updateLevelDesign(project, project.levels[1].id, (design) =>
      addWall(design, { x: 0, y: 0 }, { x: 60, y: 0 }),
    );
    const parsed = parseHomeProject(serializeHomeProject(project));
    expect(parsed).toEqual(project);
    expect(validateHomeProject(parsed)).toEqual([]);
  });

  it("rejects non-JSON and non-project payloads", () => {
    expect(() => parseHomeProject("{nope")).toThrow("not valid JSON");
    expect(() => parseHomeProject(JSON.stringify({ version: 999 }))).toThrow(
      "Not a home project",
    );
  });

  it("normalizes partial envelope fields instead of failing", () => {
    const project = createHomeProject("A");
    const partial = { ...project };
    delete partial.units;
    delete partial.building;
    const parsed = parseHomeProject(JSON.stringify(partial));
    expect(parsed.units).toBe("in");
    expect(parsed.building).toEqual({ address: "", city: "", state: "", zip: "", notes: "" });
  });
});
