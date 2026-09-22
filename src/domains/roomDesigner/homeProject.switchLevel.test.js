// Regression tests for switchLevel (HOME DESIGNER slice 2, review finding 1).
//
// switchLevel(project, currentDesign, targetId) centralizes the level switch
// so the "validate target → sync leaving level → move currentLevelId" order
// can never drift apart across handlers. The screen used to read the
// envelope from one source of truth and the edited document from another;
// this function takes all three explicitly.

import { describe, expect, it } from "vitest";
import { addWall, createEmptyDesign } from "./designerDocument";
import {
  addLevel,
  createHomeProject,
  getCurrentDesign,
  getLevel,
  switchLevel,
  validateHomeProject,
} from "./homeProject";

function twoStory() {
  let project = createHomeProject("Two-story");
  project = addLevel(project, "Second floor");
  return project;
}

describe("switchLevel", () => {
  it("syncs the editor's design into the leaving level before moving currentLevelId", () => {
    const project = twoStory();
    const secondId = project.levels[1].id;

    // The editor shows level 1 with a new wall; switch to level 2.
    const editedL1 = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    const { project: switched, design } = switchLevel(project, editedL1, secondId);

    // The wall landed in level 1's stored design (sync-before-switch order).
    expect(getLevel(switched, project.currentLevelId).design.walls).toHaveLength(1);
    // currentLevelId moved and the returned design is the target level's.
    expect(switched.currentLevelId).toBe(secondId);
    expect(design).toEqual(getCurrentDesign(switched));
    expect(design.walls).toHaveLength(0);
    expect(validateHomeProject(switched)).toEqual([]);
  });

  it("switching to the current level is a no-op returning the same project", () => {
    const project = twoStory();
    const { project: same, design } = switchLevel(
      project,
      getCurrentDesign(project),
      project.currentLevelId,
    );
    expect(same).toBe(project);
    expect(design).toEqual(getCurrentDesign(project));
  });

  it("an unknown target id throws and leaves the project untouched", () => {
    const project = twoStory();
    const before = JSON.stringify(project);
    expect(() => switchLevel(project, getCurrentDesign(project), "level_nope")).toThrow(
      /unknown level/i,
    );
    expect(JSON.stringify(project)).toBe(before);
    expect(project.currentLevelId).toBe(project.levels[0].id);
  });

  it("a damaged target level is refused: nothing moves, the leaving level keeps its original design", () => {
    const project = twoStory();
    const secondId = project.levels[1].id;
    // Corrupt the target level's design the way a damaged stored row would.
    const damaged = {
      ...project,
      levels: project.levels.map((l) =>
        l.id === secondId ? { ...l, design: { version: 999 } } : l,
      ),
    };

    const editedL1 = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    expect(() => switchLevel(damaged, editedL1, secondId)).toThrow(/damaged/i);
    // The throw left everything as it was: no sync, no currentLevelId move.
    expect(damaged.currentLevelId).toBe(project.levels[0].id);
    expect(getLevel(damaged, project.levels[0].id).design.walls).toHaveLength(0);
  });

  it("never mutates the input project", () => {
    const project = twoStory();
    const secondId = project.levels[1].id;
    const before = JSON.stringify(project);
    const editedL1 = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    const { project: switched } = switchLevel(project, editedL1, secondId);
    expect(JSON.stringify(project)).toBe(before);
    expect(switched).not.toBe(project);
    // The input project's level 1 design still has no walls.
    expect(getLevel(project, project.levels[0].id).design.walls).toHaveLength(0);
  });

  it("round-trips edits across both levels exactly like the screen's switch sequence", () => {
    const project = twoStory();
    const secondId = project.levels[1].id;

    const editedL1 = addWall(getCurrentDesign(project), { x: 0, y: 0 }, { x: 60, y: 0 });
    const first = switchLevel(project, editedL1, secondId);

    const editedL2 = addWall(first.design, { x: 0, y: 0 }, { x: 30, y: 0 });
    const back = switchLevel(first.project, editedL2, project.levels[0].id);

    expect(getLevel(back.project, project.levels[0].id).design.walls).toHaveLength(1);
    expect(getLevel(back.project, secondId).design.walls).toHaveLength(1);
    expect(back.project.currentLevelId).toBe(project.levels[0].id);
    expect(validateHomeProject(back.project)).toEqual([]);
  });
});
