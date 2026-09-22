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
  addLevel,
  createHomeProject,
  ensureHomeProject,
  getCurrentDesign,
  getLevel,
  isHomeProject,
  renameProject,
  serializeHomeProject,
  switchLevel,
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

// HOME DESIGNER slice 2: the screen persists the whole HomeProject envelope
// (levels[], currentLevelId, building metadata). Exact sequence replayed:
//   load:   project = ensureHomeProject(body.project.design, body.project.name)
//           dispatch({ type: "LOAD_DESIGN", design: getCurrentDesign(project) })
//   save:   updated = updateLevelDesign(project, project.currentLevelId, () => edited)
//           renamed = renameProject(updated, headerName)            (when changed)
//           PUT body = JSON.stringify({ name, design: <envelope> })
//   switch: ({ project: switched, design } = switchLevel(project, editedDoc, targetId))
//           dispatch({ type: "LOAD_DESIGN", design })
describe("DesignerScreen slice 2 wiring", () => {
  it("saves the envelope with every level intact after editing the current level", () => {
    let project = createHomeProject("Two-story");
    project = addLevel(project, "Second floor");
    const secondId = project.levels[1].id;

    // User draws on level 1, then the screen syncs and saves the envelope.
    const edited = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    const updated = updateLevelDesign(project, project.currentLevelId, () => edited);
    const putBody = JSON.parse(JSON.stringify({ name: "Two-story", design: updated }));

    expect(putBody.design.levels).toHaveLength(2);
    expect(putBody.design.levels[0].design.walls).toHaveLength(1);
    expect(putBody.design.levels[1].design.walls).toHaveLength(0);
    expect(putBody.design.levels[1].id).toBe(secondId);
    expect(putBody.design.currentLevelId).toBe(updated.currentLevelId);
    expect(validateHomeProject(updated)).toEqual([]);
  });

  it("a legacy payload saves back as a one-level envelope", () => {
    const legacy = addWall(createEmptyDesign("Shop"), { x: 0, y: 0 }, { x: 60, y: 0 });
    const project = ensureHomeProject(legacy, "Shop project");
    const edited = addWall(getCurrentDesign(project), { x: 60, y: 0 }, { x: 60, y: 40 });
    const updated = updateLevelDesign(project, project.currentLevelId, () => edited);
    const putBody = JSON.parse(JSON.stringify({ name: "Shop project", design: updated }));

    // Legacy rows upgrade to the envelope on first save — no migration needed.
    expect(isHomeProject(putBody.design)).toBe(true);
    expect(putBody.design.levels).toHaveLength(1);
    expect(putBody.design.levels[0].design.walls).toHaveLength(2);
    expect(putBody.design.currentLevelId).toBe(putBody.design.levels[0].id);
  });

  it("switching levels keeps each level's edits", () => {
    let project = createHomeProject("Two-story");
    project = addLevel(project, "Second floor");
    const secondId = project.levels[1].id;

    // Draw on level 1, then switch to level 2 exactly as the screen does.
    const editedL1 = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    const first = switchLevel(project, editedL1, secondId);
    expect(first.design.walls).toHaveLength(0);

    // Draw on level 2, switch back: level 1's wall must still be there.
    const editedL2 = addWall(first.design, { x: 0, y: 0 }, { x: 30, y: 0 });
    const back = switchLevel(first.project, editedL2, project.currentLevelId);
    expect(getLevel(back.project, project.currentLevelId).design.walls).toHaveLength(1);
    expect(getLevel(back.project, secondId).design.walls).toHaveLength(1);
    expect(validateHomeProject(back.project)).toEqual([]);
  });

  it("the header rename lands on the envelope name, not just the request", () => {
    const project = ensureHomeProject(createEmptyDesign("Old"), "Old");
    const updated = updateLevelDesign(project, project.currentLevelId, (d) => d);
    const renamed = renameProject(updated, "New name");
    const putBody = JSON.parse(JSON.stringify({ name: "New name", design: renamed }));
    expect(putBody.design.name).toBe("New name");
    expect(putBody.name).toBe("New name");
  });

  it("the sync path rejects a corrupt document before it can enter the envelope", () => {
    const project = ensureHomeProject(createEmptyDesign("Shop"), "Shop");
    expect(() =>
      updateLevelDesign(project, project.currentLevelId, () => ({ version: 999 })),
    ).toThrow(/invalid/i);
  });

  it("an envelope payload with two levels loads both levels for the switcher", () => {
    let stored = createHomeProject("Two-story");
    stored = addLevel(stored, "Second floor");
    const persisted = JSON.parse(serializeHomeProject(stored));
    const project = ensureHomeProject(persisted, "Two-story");
    expect(project.levels.map((l) => l.name)).toEqual(["Level 1", "Second floor"]);
    expect(project.currentLevelId).toBe(stored.currentLevelId);
    expect(validateHomeProject(project)).toEqual([]);
  });
});
