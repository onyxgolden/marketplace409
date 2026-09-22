// homeDxfExport.contract.test.js — exporter contract for slice 6.
//
// The review-mandated contract: the exporter never mutates the project,
// output is deterministic, every DXF is structurally valid (sections,
// EOF), every entity sits on a declared layer, and the serializer guard
// rejects NaN / Infinity / undefined before any entity counting runs.

import { describe, expect, it, beforeEach } from "vitest";
import {
  findBadDxfTokens,
  planToDxf,
} from "./homeDxfExport";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  resetDesignerIds,
} from "./designerDocument";
import { createHomeProject, resetHomeProjectIds } from "./homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function cabinProject() {
  let d = createEmptyDesign("Cabin");
  d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
  d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
  d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
  d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
  d = addOpening(d, "south", { type: "door", offsetIn: 40, widthIn: 36 });
  const project = createHomeProject("Cabin project");
  const level = project.levels[0];
  return { ...project, levels: [{ ...level, design: d }] };
}

/** Minimal pair parser: [{ entity, layer }] in ENTITIES order. */
function parseEntities(dxf) {
  // Parser guard runs first: never count entities in a corrupt string.
  const bad = findBadDxfTokens(dxf);
  if (bad.length > 0) {
    throw new Error(`DXF contains forbidden tokens: ${bad.join(", ")}`);
  }
  const lines = dxf.split("\n");
  const entities = [];
  let current = null;
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i];
    const value = lines[i + 1];
    if (code === "0") {
      if (current) entities.push(current);
      current = ["LINE", "LWPOLYLINE", "ARC", "TEXT"].includes(value)
        ? { entity: value, layer: null }
        : null;
    } else if (current && code === "8") {
      current.layer = value;
    }
  }
  if (current) entities.push(current);
  return entities;
}

describe("DXF exporter contract", () => {
  it("never mutates the project", () => {
    const project = cabinProject();
    const before = JSON.stringify(project);
    const result = planToDxf(project);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("is deterministic: the same project always yields the same string", () => {
    const project = cabinProject();
    const a = planToDxf(project);
    const b = planToDxf(project);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.dxf).toBe(b.dxf);
  });

  it("emits a structurally valid DXF: sections, layer table, valid EOF", () => {
    const { dxf } = planToDxf(cabinProject());
    expect(dxf.startsWith("0\nSECTION\n2\nHEADER\n")).toBe(true);
    expect(dxf.endsWith("0\nEOF\n")).toBe(true);
    // Layer table declares every layer the entities use.
    const declared = new Set(
      [...dxf.matchAll(/^2\n(A-L\d\d-[A-Z-]+)$/gm)].map((m) => m[1]),
    );
    const entities = parseEntities(dxf);
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(e.layer, `${e.entity} without layer`).toBeTruthy();
      expect(declared.has(e.layer), `${e.layer} not in TABLES`).toBe(true);
    }
  });

  it("entity stats match the parsed entity count", () => {
    const result = planToDxf(cabinProject());
    expect(result.stats.entityCount).toBe(parseEntities(result.dxf).length);
  });

  it("converts canvas Y-down to CAD Y-up exactly once", () => {
    // X = east/right unchanged; Y = north/up flipped. A wall endpoint at
    // plan (10, 20) must appear as DXF (10, -20) — and never double-flip.
    let d = createEmptyDesign("Flip");
    d = addWall(d, { x: 10, y: 20 }, { x: 60, y: 20 }, { id: "w1" });
    const project = createHomeProject("Flip");
    const withDesign = {
      ...project,
      levels: [{ ...project.levels[0], design: d }],
    };
    const { dxf } = planToDxf(withDesign);
    // Wall faces sit at plan y = 20 +/- 2.25 (default thickness); DXF Y is
    // the negated plan Y.
    expect(dxf).toContain("10\n10\n");
    expect(dxf).toContain("20\n-22.25\n");
    expect(dxf).toContain("20\n-17.75\n");
    expect(dxf).not.toContain("20\n20\n");
  });

  it("serializes coordinates at 4 decimals", () => {
    let d = createEmptyDesign("Round");
    d = addWall(d, { x: 0.123456, y: 0 }, { x: 10, y: 0 }, { id: "w1" });
    const project = createHomeProject("Round");
    const withDesign = {
      ...project,
      levels: [{ ...project.levels[0], design: d }],
    };
    const { dxf } = planToDxf(withDesign);
    expect(dxf).toContain("10\n0.1235\n");
    expect(findBadDxfTokens(dxf)).toEqual([]);
  });

  it("sanitizes TEXT so group-code pairing can never split", () => {
    let d = createEmptyDesign("Labels");
    d = addWall(d, { x: 0, y: 0 }, { x: 60, y: 0 }, { id: "w1" });
    d = {
      ...d,
      rooms: [
        {
          id: "room_1",
          label: "Bed\nroom\x01<script>",
          polygon: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 40 },
            { x: 0, y: 40 },
          ],
        },
      ],
    };
    const project = createHomeProject("Labels");
    const withDesign = {
      ...project,
      levels: [{ ...project.levels[0], design: d }],
    };
    const { dxf } = planToDxf(withDesign);
    expect(dxf).toContain("1\nBedroom<script>");
    expect(findBadDxfTokens(dxf)).toEqual([]);
  });

  it("the parser guard rejects a DXF string containing bad tokens", () => {
    expect(() => parseEntities("0\nLINE\n10\nNaN\n0\nEOF\n")).toThrow(/NaN/);
    expect(() => parseEntities("0\nLINE\n10\nInfinity\n0\nEOF\n")).toThrow(/Infinity/);
    expect(() => parseEntities("0\nLINE\n10\nundefined\n0\nEOF\n")).toThrow(/undefined/);
  });
});
