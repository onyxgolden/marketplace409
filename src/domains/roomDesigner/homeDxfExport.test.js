// homeDxfExport.js — FORGE Home Designer slice 6 DXF export.
//
// Contract: pure ASCII DXF from canonical project geometry. AC1014 header
// with a conservative entity vocabulary (LWPOLYLINE/LINE/ARC/TEXT only),
// AIA discipline-first layers, empty BLOCKS section, Y-up CAD coordinates.

import { describe, expect, it, beforeEach } from "vitest";
import {
  DXF_CONFIG,
  dimLabel,
  doorSwingDxf,
  dxfFileName,
  planToDxf,
  sanitizeDxfText,
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

function roomDesign() {
  // 120" x 96" rectangle: one wall per side, a door in the south wall, a
  // window in the north wall, one labeled room.
  let d = createEmptyDesign("Cabin");
  d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
  d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
  d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
  d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
  d = addOpening(d, "south", { type: "door", offsetIn: 40, widthIn: 36 });
  d = addOpening(d, "north", { type: "window", offsetIn: 30, widthIn: 48 });
  return {
    ...d,
    rooms: [
      {
        id: "room_1",
        label: "Cabin",
        polygon: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 96 },
          { x: 0, y: 96 },
        ],
      },
    ],
  };
}

function roomProject() {
  const project = createHomeProject("Cabin project");
  const level = project.levels[0];
  return { ...project, levels: [{ ...level, design: roomDesign() }] };
}

function countEntities(dxf, type) {
  return dxf.split(`0\n${type}\n`).length - 1;
}

describe("planToDxf", () => {
  it("exports a golden DXF for the fixed room fixture", () => {
    const result = planToDxf(roomProject());
    expect(result.ok).toBe(true);
    expect(result.dxf).toMatchSnapshot();
  });

  it("emits the expected entity counts for the fixture", () => {
    const result = planToDxf(roomProject());
    expect(result.ok).toBe(true);
    // Walls: south (door) and north (window) walls split into 2 segments x
    // 2 faces = 4 LWPOLYLINE each; east/west unsplit = 2 each.
    expect(countEntities(result.dxf, "LWPOLYLINE")).toBe(12);
    // LINEs: 4 gap caps + 1 door leaf + 2 window glass + 7 horizontal dim
    // (1 line + 2 witness + 4 arrow barbs) + 7 vertical dim = 21.
    expect(countEntities(result.dxf, "LINE")).toBe(21);
    expect(countEntities(result.dxf, "ARC")).toBe(1);
    // TEXT: room label + 2 dimension values.
    expect(countEntities(result.dxf, "TEXT")).toBe(3);
    expect(result.stats.entityCount).toBe(37);
  });

  it("locks the header flags: AC1014, inches, imperial", () => {
    const { dxf } = planToDxf(roomProject());
    expect(dxf).toContain("9\n$ACADVER\n1\nAC1014");
    expect(dxf).toContain("9\n$INSUNITS\n70\n1");
    expect(dxf).toContain("9\n$MEASUREMENT\n70\n0");
  });

  it("uses AIA discipline-first layers with zero-padded level tags", () => {
    const { dxf, stats } = planToDxf(roomProject());
    for (const name of ["A-L01-WALL", "A-L01-DOOR", "A-L01-WIND", "A-L01-ROOM", "A-L01-DIMS"]) {
      expect(dxf).toContain(`2\n${name}\n`);
    }
    expect(stats.layerCount).toBe(5);
  });

  it("emits sections in HEADER, TABLES, BLOCKS, ENTITIES, EOF order", () => {
    const { dxf } = planToDxf(roomProject());
    const order = ["2\nHEADER", "2\nTABLES", "2\nBLOCKS", "2\nENTITIES", "0\nEOF"].map((s) =>
      dxf.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the entity vocabulary to LWPOLYLINE/LINE/ARC/TEXT only", () => {
    const { dxf } = planToDxf(roomProject());
    const entities = dxf.split("2\nENTITIES\n")[1].split("0\nENDSEC")[0];
    const kinds = [...entities.matchAll(/^0\n([A-Z]+)$/gm)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => ["LWPOLYLINE", "LINE", "ARC", "TEXT"].includes(k))).toBe(true);
    expect(kinds).not.toContain("DIMENSION");
  });

  it("subtracts openings from walls — no face geometry inside the door gap", () => {
    const { dxf } = planToDxf(roomProject());
    // The south wall runs along plan y=0 with a door gap at x=40..76 and
    // faces at plan y=+/-2.25 (DXF y=-/+2.25). With the gap subtracted, no
    // wall-face vertex may lie strictly inside the gap at those y values —
    // the faces end exactly at x=40 and x=76.
    const lines = dxf.split("\n");
    const bad = [];
    let i = 0;
    while (i < lines.length - 1) {
      if (lines[i] === "0" && lines[i + 1] === "LWPOLYLINE") {
        let layer = null;
        let x = null;
        let y = null;
        i += 2;
        while (i < lines.length - 1 && !(lines[i] === "0")) {
          const code = lines[i];
          const value = lines[i + 1];
          if (code === "8") layer = value;
          else if (code === "10") x = Number(value);
          else if (code === "20") {
            y = Number(value);
            if (layer === "A-L01-WALL" && Math.abs(Math.abs(y) - 2.25) < 0.001 && x > 40 && x < 76) {
              bad.push(`(${x}, ${y})`);
            }
          }
          i += 2;
        }
        continue;
      }
      i += 1;
    }
    expect(bad).toEqual([]);
  });

  it("labels reference dimensions in feet-inches with arrow ticks", () => {
    const { dxf } = planToDxf(roomProject());
    expect(dxf).toContain(`1\n${dimLabel(120)}`);
    expect(dxf).toContain(`1\n${dimLabel(96)}`);
    expect(dimLabel(120)).toBe("10'-0\"");
    expect(dimLabel(96)).toBe("8'-0\"");
  });

  it("exports an empty level as a valid, entity-free DXF", () => {
    const project = createHomeProject("Empty");
    const result = planToDxf(project);
    expect(result.ok).toBe(true);
    expect(result.stats.entityCount).toBe(0);
    expect(result.dxf).toContain("2\nENTITIES\n0\nENDSEC");
    expect(result.dxf.endsWith("0\nEOF\n")).toBe(true);
  });

  it("fails closed on corrupt input", () => {
    expect(planToDxf(null).ok).toBe(false);
    expect(planToDxf({}).ok).toBe(false);
    expect(planToDxf({ version: 1, levels: [] }).ok).toBe(false);
  });

  it("fails closed on unknown level ids", () => {
    const result = planToDxf(roomProject(), { levelIds: ["nope"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown level id/);
  });

  it("keeps stable layer names when exporting a level subset", () => {
    const base = roomProject();
    const second = { ...base.levels[0], id: "level_2", name: "Level 2" };
    const project = { ...base, levels: [...base.levels, second] };
    const result = planToDxf(project, { levelIds: ["level_2"] });
    expect(result.ok).toBe(true);
    expect(result.dxf).toContain("A-L02-WALL");
    expect(result.dxf).not.toContain("A-L01-WALL");
  });

  it("refuses elevation export in slice 6", () => {
    const result = planToDxf(roomProject(), { includeElevations: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/slice 6/i);
  });

  it("surfaces the wall-thickness default as an assumption", () => {
    const project = roomProject();
    const level = project.levels[0];
    const noSettings = {
      ...project,
      levels: [{ ...level, design: { ...level.design, settings: {} } }],
    };
    const { stats } = planToDxf(noSettings);
    expect(stats.assumptions.some((a) => a.includes("Default wall thickness"))).toBe(true);
    // And with the design's own setting, no such assumption appears.
    const { stats: withSetting } = planToDxf(project);
    expect(withSetting.assumptions.some((a) => a.includes("Default wall thickness"))).toBe(false);
  });
});

describe("doorSwingDxf", () => {
  const base = { hingeX: 0, hingeY: 0, widthIn: 36 };

  it("start hinge / positive face: leaf along the wall, CCW 90-degree arc", () => {
    const s = doorSwingDxf({ ...base, leafAngleDxfDeg: 0, hinge: "start", face: "positive" });
    expect(s.leaf).toEqual([[0, 0], [36, 0]]);
    expect(s.arc.startDeg).toBe(0);
    expect(s.arc.endDeg).toBe(90);
    expect(s.arc.endDeg - s.arc.startDeg).toBe(90);
  });

  it("start hinge / negative face (outward swing): arc sweeps the other way", () => {
    const s = doorSwingDxf({ ...base, leafAngleDxfDeg: 0, hinge: "start", face: "negative" });
    expect(s.leaf).toEqual([[0, 0], [36, 0]]);
    expect(s.arc.startDeg).toBe(-90);
    expect(s.arc.endDeg).toBe(0);
    expect(s.arc.endDeg - s.arc.startDeg).toBe(90);
  });

  it("end hinge (right-hinge): caller points the leaf back across the opening", () => {
    const s = doorSwingDxf({ ...base, leafAngleDxfDeg: 180, hinge: "end", face: "positive" });
    expect(s.leaf[1][0]).toBeCloseTo(-36, 4);
    expect(s.leaf[1][1]).toBeCloseTo(0, 4);
    expect(s.arc.startDeg).toBe(180);
    expect(s.arc.endDeg).toBe(270);
    expect(s.arc.endDeg - s.arc.startDeg).toBe(90);
  });

  it("end hinge / negative face: CCW normalization still holds", () => {
    const s = doorSwingDxf({ ...base, leafAngleDxfDeg: 180, hinge: "end", face: "negative" });
    expect(s.arc.startDeg).toBe(90);
    expect(s.arc.endDeg).toBe(180);
    expect(s.arc.endDeg - s.arc.startDeg).toBe(90);
  });

  it("throws on bad input", () => {
    expect(() => doorSwingDxf({ ...base, widthIn: 0 })).toThrow();
    expect(() => doorSwingDxf({ ...base, hinge: "middle" })).toThrow();
    expect(() => doorSwingDxf({ ...base, face: "sideways" })).toThrow();
  });

  it("planToDxf emits the door arc with a CCW 90-degree sweep", () => {
    const { dxf } = planToDxf(roomProject());
    const m = dxf.match(/0\nARC\n8\nA-L01-DOOR\n10\n([^\n]+)\n20\n([^\n]+)\n40\n([^\n]+)\n50\n([^\n]+)\n51\n([^\n]+)/);
    expect(m).not.toBeNull();
    const [, , , radius, startDeg, endDeg] = m.map(Number);
    expect(radius).toBe(36);
    expect(endDeg - startDeg).toBe(90);
  });
});

describe("dxf helpers", () => {
  it("sanitizeDxfText strips control characters", () => {
    expect(sanitizeDxfText("Bed\nroom\x01")).toBe("Bedroom");
    expect(sanitizeDxfText(null)).toBe("");
  });

  it("dxfFileName is filesystem-safe and date-stamped", () => {
    expect(dxfFileName("My Cabin", new Date(2026, 8, 22))).toBe("My Cabin-20260922.dxf");
    expect(dxfFileName('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("DXF_CONFIG pins the locked format contract", () => {
    expect(DXF_CONFIG.acadVersion).toBe("AC1014");
    expect(DXF_CONFIG.insUnits).toBe(1);
    expect(DXF_CONFIG.measurement).toBe(0);
    expect(DXF_CONFIG.roomLabelHeightIn).toBe(12);
    expect(DXF_CONFIG.coordinatePrecision).toBe(4);
  });
});
