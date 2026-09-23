import { describe, expect, it } from "vitest";
import {
  HOME_PROJECT_VERSION,
  validateHomeProject,
} from "./homeProject";
import { wallLength } from "./designerGeometry";
import { measureHomeProject } from "./homeQuantities";
import { estimateProject } from "./homeEstimate";
import {
  SAMPLE_PROJECTS,
  SAMPLE_SEED_ID,
  SAMPLE_NAME,
  STAIR_ANNOTATION_SOURCE,
  STAIR_BOX,
  buildMaplewoodTwoStory,
} from "./sampleProjects";

function build() {
  return buildMaplewoodTwoStory();
}

function allEntityIds(project) {
  const ids = [];
  for (const level of project.levels) {
    ids.push(level.id);
    const d = level.design;
    for (const wall of d.walls) ids.push(wall.id);
    for (const opening of d.openings) ids.push(opening.id);
    for (const room of d.rooms) ids.push(room.id);
    for (const piece of d.furniture) ids.push(piece.id);
    for (const annotation of d.annotations || []) ids.push(annotation.id);
    for (const symbol of d.symbols || []) ids.push(symbol.id);
    for (const run of d.pipes || []) ids.push(run.id);
  }
  return ids;
}

describe("sampleProjects: Maplewood Two-Story seed", () => {
  it("builds a valid two-level home project", () => {
    const project = build();
    expect(validateHomeProject(project)).toEqual([]);
    expect(project.version).toBe(HOME_PROJECT_VERSION);
    expect(project.name).toBe(SAMPLE_NAME);
    expect(project.levels).toHaveLength(2);
    expect(project.levels.map((l) => l.name)).toEqual([
      "First Floor",
      "Second Floor",
    ]);
    const ids = new Set(project.levels.map((l) => l.id));
    expect(ids.has(project.currentLevelId)).toBe(true);
    for (const level of project.levels) {
      expect(level.design).toBeTruthy();
      expect(typeof level.design).toBe("object");
    }
  });

  it("exposes the sample in the gallery list", () => {
    expect(SAMPLE_PROJECTS).toHaveLength(1);
    const [sample] = SAMPLE_PROJECTS;
    expect(sample.seedId).toBe(SAMPLE_SEED_ID);
    expect(sample.name).toBe(SAMPLE_NAME);
    expect(typeof sample.build).toBe("function");
    expect(sample.build()).toBeTruthy();
  });

  it("keeps every id unique across the whole document", () => {
    const project = build();
    const ids = allEntityIds(project);
    expect(ids.length).toBeGreaterThan(100);
    const seen = new Set();
    const duplicates = [];
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    expect(duplicates).toEqual([]);
  });

  it("is deterministic across builds", () => {
    const a = JSON.stringify(build());
    const b = JSON.stringify(build());
    expect(a).toBe(b);
  });

  it("carries no identity: no projectId, no owner fields, no timestamps", () => {
    const project = build();
    expect("createdAt" in project).toBe(false);
    expect("updatedAt" in project).toBe(false);
    const json = JSON.stringify(project);
    expect(json).not.toContain("projectId");
    expect(json).not.toContain("owner_id");
    expect(json).not.toContain("ownerId");
    expect(json).not.toContain("userId");
    expect(json).not.toContain("draft");
    // The seed identifier is a catalog key only — never a stored id.
    expect(json).not.toContain(SAMPLE_SEED_ID);
  });
});

describe("sampleProjects: opening/wall invariants", () => {
  it("every opening references a real wall and sits inside it", () => {
    const project = build();
    let checked = 0;
    for (const level of project.levels) {
      const wallById = new Map(level.design.walls.map((w) => [w.id, w]));
      expect(level.design.openings.length).toBeGreaterThan(0);
      for (const opening of level.design.openings) {
        const wall = wallById.get(opening.wallId);
        expect(wall, `opening ${opening.id} references missing wall`).toBeTruthy();
        expect(opening.offsetIn).toBeGreaterThanOrEqual(0);
        expect(opening.widthIn).toBeGreaterThan(0);
        const length = wallLength(wall);
        expect(opening.offsetIn + opening.widthIn).toBeLessThanOrEqual(
          length + 1e-6,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("both floors have doors and windows", () => {
    const project = build();
    for (const level of project.levels) {
      const types = level.design.openings.map((o) => o.type);
      expect(types).toContain("door");
      expect(types).toContain("window");
    }
  });
});

describe("sampleProjects: stair representation", () => {
  function stairGroup(level) {
    return (level.design.annotations || []).filter(
      (a) => a.source === STAIR_ANNOTATION_SOURCE,
    );
  }

  function nativeStair(level) {
    return (level.design.symbols || []).find(
      (s) => s.symbolId === "stairs-straight",
    );
  }

  it("level 1 carries a native stair symbol sized to the stairwell", () => {
    const project = build();
    const [first] = project.levels;
    // Legacy annotations are retired on level 1: the native symbol is the
    // single source of truth for the 2D plan and the 3D model.
    expect(stairGroup(first)).toHaveLength(0);
    const stair = nativeStair(first);
    expect(stair).toBeTruthy();
    expect(stair.x).toBe((STAIR_BOX.x1 + STAIR_BOX.x2) / 2);
    expect(stair.y).toBe((STAIR_BOX.y1 + STAIR_BOX.y2) / 2);
    expect(stair.widthIn).toBe(STAIR_BOX.y2 - STAIR_BOX.y1); // run
    expect(stair.depthIn).toBe(STAIR_BOX.x2 - STAIR_BOX.x1); // width
    expect(stair.rotationDeg).toBe(90);
  });

  it("level 2 keeps the stairwell annotation, aligned to the stairwell", () => {
    const project = build();
    const [, second] = project.levels;
    expect(nativeStair(second)).toBeFalsy();
    const g2 = stairGroup(second);
    expect(g2.length).toBeGreaterThan(0);
    const outline = g2.find((a) => a.kind === "path" && a.closed);
    expect(outline).toBeTruthy();
    expect(outline.points).toEqual([
      { x: STAIR_BOX.x1, y: STAIR_BOX.y1 },
      { x: STAIR_BOX.x2, y: STAIR_BOX.y1 },
      { x: STAIR_BOX.x2, y: STAIR_BOX.y2 },
      { x: STAIR_BOX.x1, y: STAIR_BOX.y2 },
    ]);
    // Tread lines inside the box.
    const treads = g2.filter((a) => a.kind === "path" && !a.closed);
    expect(treads.length).toBeGreaterThanOrEqual(5);
    for (const tread of treads) {
      expect(tread.points).toHaveLength(2);
      const [p, q] = tread.points;
      expect(p.y).toBe(q.y);
      expect(p.y).toBeGreaterThan(STAIR_BOX.y1);
      expect(p.y).toBeLessThan(STAIR_BOX.y2);
    }
  });

  it("labels the stairwell arrival DOWN on floor 2", () => {
    const project = build();
    const [, second] = project.levels;
    const label = stairGroup(second).find((a) => a.kind === "label");
    expect(label.text).toBe("DOWN");
  });
});

describe("sampleProjects: estimate compatibility", () => {
  it("measures and estimates with no NaN and no missing quantities", () => {
    const project = build();
    const measured = measureHomeProject(project);
    expect(measured.ok).toBe(true);
    expect(measured.levelCount).toBe(2);
    expect(measured.totals.doorCount).toBeGreaterThan(0);
    expect(measured.totals.windowCount).toBeGreaterThan(0);
    expect(measured.totals.netRoomAreaSqFt).toBeGreaterThan(0);

    const estimated = estimateProject(project);
    expect(estimated.ok).toBe(true);
    expect(estimated.items.length).toBeGreaterThan(0);
    for (const item of estimated.items) {
      expect(typeof item.quantity).toBe("number");
      expect(Number.isFinite(item.quantity)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(0);
      expect(typeof item.assemblyId).toBe("string");
    }
    const quantities = Object.fromEntries(
      estimated.items.map((i) => [i.assemblyId, i.quantity]),
    );
    expect(quantities.flooring).toBeGreaterThan(0);
    expect(quantities.wall_paint).toBeGreaterThan(0);
    expect(quantities.interior_door).toBe(measured.totals.doorCount);
    expect(quantities.windows).toBe(measured.totals.windowCount);
  });

  it("furniture does not break estimation", () => {
    const project = build();
    const furnitureCount = project.levels.reduce(
      (n, l) => n + l.design.furniture.length,
      0,
    );
    expect(furnitureCount).toBeGreaterThan(20);
    const estimated = estimateProject(project);
    expect(estimated.ok).toBe(true);
  });
});
