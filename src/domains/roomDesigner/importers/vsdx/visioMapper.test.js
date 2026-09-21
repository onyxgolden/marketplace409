/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { applyImportResult } from "./visioMapper.js";
import { createEmptyDesign } from "../../designerDocument.js";

const importRecords = () => ({
  walls: [{ id: "vsdx-p0-s1", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
  rooms: [],
  openings: [{ id: "vsdx-p0-s2", wallId: "vsdx-p0-s1", at: { x: 5, y: 0 } }],
  furniture: [],
  pipes: [],
  symbols: [],
  annotations: [{ id: "vsdx-p0-s3", kind: "path", points: [{ x: 1, y: 1 }] }],
});

describe("applyImportResult duplicate-id collisions", () => {
  it("re-importing the same page keeps both copies with unique ids", () => {
    const design = createEmptyDesign("double");
    const once = applyImportResult(design, importRecords());
    const twice = applyImportResult(once, importRecords());

    expect(twice.walls).toHaveLength(2);
    expect(twice.openings).toHaveLength(2);
    expect(twice.annotations).toHaveLength(2);

    // First import keeps the deterministic ids …
    expect(twice.walls[0].id).toBe("vsdx-p0-s1");
    // … the second import is suffixed instead of colliding.
    expect(twice.walls[1].id).toBe("vsdx-p0-s1-2");
    expect(twice.openings[1].id).toBe("vsdx-p0-s2-2");
    expect(twice.annotations[1].id).toBe("vsdx-p0-s3-2");

    const ids = [
      ...twice.walls,
      ...twice.openings,
      ...twice.annotations,
    ].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Opening→wall references still point at the right wall copy.
    expect(twice.openings[0].wallId).toBe(twice.walls[0].id);
    expect(twice.openings[1].wallId).toBe(twice.walls[1].id);
  });

  it("suffixes against ids already in the design, not just the import", () => {
    const design = createEmptyDesign("existing");
    const withWall = applyImportResult(design, {
      ...importRecords(),
      walls: [{ id: "custom-1", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }],
    });
    const merged = applyImportResult(withWall, {
      ...importRecords(),
      walls: [{ id: "custom-1", a: { x: 2, y: 2 }, b: { x: 3, y: 3 } }],
    });
    expect(merged.walls.map((w) => w.id)).toEqual(["custom-1", "custom-1-2"]);
  });

  it("increments the suffix past multiple collisions", () => {
    let design = createEmptyDesign("triple");
    design = applyImportResult(design, importRecords());
    design = applyImportResult(design, importRecords());
    design = applyImportResult(design, importRecords());
    expect(design.walls.map((w) => w.id).sort()).toEqual([
      "vsdx-p0-s1",
      "vsdx-p0-s1-2",
      "vsdx-p0-s1-3",
    ]);
  });

  it("does not mutate the incoming records or the original design", () => {
    const design = createEmptyDesign("pure");
    const records = importRecords();
    const next = applyImportResult(design, records);
    const again = applyImportResult(next, importRecords());
    expect(records.walls[0].id).toBe("vsdx-p0-s1");
    expect(design.walls).toHaveLength(0);
    expect(next.walls).toHaveLength(1);
    expect(again.walls).toHaveLength(2);
  });
});
