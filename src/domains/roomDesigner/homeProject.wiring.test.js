// Integration test for the DesignerScreen load/save wiring contract
// (src/components/designer/DesignerScreen.jsx), added per final review of
// Home Designer slice 1.
//
// Slice 1 keeps the project envelope in memory; the screen performs exactly:
//   load: project = ensureHomeProject(body.project.design, body.project.name)
//         dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(project) })
//   save: updated = updateLevelDesign(project, project.currentLevelId, () => edited)
//         PUT body = JSON.stringify({ name, design: getCurrentDesign(updated) })
//
// These tests replay that sequence (minus React/DOM, which this repo does not
// mount in unit tests) so the wiring the screen depends on is covered: loads
// never throw on real-world payloads, and the PUT payload shape is unchanged.

import { describe, expect, it } from "vitest";
import { addWall, createEmptyDesign } from "./designerDocument";
import {
  ensureHomeProject,
  getCurrentDesign,
  isHomeProject,
  updateLevelDesign,
  validateHomeProject,
} from "./homeProject";

describe("DesignerScreen load wiring", () => {
  it("wraps a legacy design payload into a one-level project for LOAD_DESIGN", () => {
    const legacy = addWall(createEmptyDesign("Shop"), { x: 0, y: 0 }, { x: 60, y: 0 });
    const project = ensureHomeProject(legacy, "Shop project");
    expect(isHomeProject(project)).toBe(true);
    expect(project.levels).toHaveLength(1);
    const designForReducer = getCurrentDesign(project);
    expect(designForReducer.walls).toHaveLength(1);
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("a null design payload loads an empty project instead of crashing the screen", () => {
    const project = ensureHomeProject(null, "Shop project");
    expect(isHomeProject(project)).toBe(true);
    // The reducer receives a valid empty document, never an exception.
    expect(getCurrentDesign(project)).toBeDefined();
    expect(validateHomeProject(project)).toEqual([]);
  });

  it("an undefined design payload loads an empty project instead of crashing the screen", () => {
    const project = ensureHomeProject(undefined, "Shop project");
    expect(isHomeProject(project)).toBe(true);
    expect(getCurrentDesign(project)).toBeDefined();
    expect(validateHomeProject(project)).toEqual([]);
  });
});

describe("DesignerScreen save wiring", () => {
  it("syncs the edited document back and keeps the PUT payload as { name, design }", () => {
    const legacy = addWall(createEmptyDesign("Shop"), { x: 0, y: 0 }, { x: 60, y: 0 });
    const project = ensureHomeProject(legacy, "Shop project");

    // The user draws a second wall; the screen saves state.design.
    const edited = addWall(getCurrentDesign(project), { x: 60, y: 0 }, { x: 60, y: 40 });
    const updated = updateLevelDesign(project, project.currentLevelId, () => edited);
    const designPayload = getCurrentDesign(updated);

    const putBody = JSON.parse(JSON.stringify({ name: "Shop project", design: designPayload }));
    expect(Object.keys(putBody).sort()).toEqual(["design", "name"]);
    expect(putBody.name).toBe("Shop project");
    expect(putBody.design.walls).toHaveLength(2);
    expect(putBody.design).toEqual(edited);
    // The envelope never leaks into the persisted payload.
    expect(putBody.design.levels).toBeUndefined();
    expect(validateHomeProject(updated)).toEqual([]);
  });
});
