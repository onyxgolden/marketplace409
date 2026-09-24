import { beforeEach, describe, expect, it } from "vitest";
import { summarizeDesignForEstimating } from "./designerExports";
import {
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
  resetDesignerIds,
} from "./designerDocument";
import "./pipingCatalog";

beforeEach(() => resetDesignerIds());

describe("designerExports — summarizeDesignForEstimating", () => {
  it("projects a design down to estimating facts", () => {
    let d = createEmptyDesign("Demo house");
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 12x12 = 144 sq ft
    d = addRoomFromTemplate(d, "bathroom", { x: 200, y: 0 }); // 8x6 = 48 sq ft
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 });
    d = addOpening(d, d.walls[4].id, { type: "window", offsetIn: 12 });
    d = placeFurniture(d, "bed-queen", 72, 72);

    const summary = summarizeDesignForEstimating(d);
    expect(summary.designName).toBe("Demo house");
    expect(summary.roomCount).toBe(2);
    // An unnamed room exports a blank label; area is what estimating uses.
    expect(summary.rooms[0]).toMatchObject({ label: "", areaSqFt: 144 });
    expect(summary.rooms[1]).toMatchObject({ label: "", areaSqFt: 48 });
    expect(summary.totalRoomAreaSqFt).toBe(192);
    expect(summary.wallCount).toBe(8);
    expect(summary.totalWallLengthIn).toBe(2 * (144 + 144) + 2 * (96 + 72));
    expect(summary.doorCount).toBe(1);
    expect(summary.windowCount).toBe(1);
    expect(summary.openingCount).toBe(2);
    expect(summary.furnitureCount).toBe(1);
    expect(summary.wallHeightIn).toBe(108);
  });

  it("summarizes an empty design without errors", () => {
    const summary = summarizeDesignForEstimating(createEmptyDesign());
    expect(summary.roomCount).toBe(0);
    expect(summary.totalRoomAreaSqFt).toBe(0);
    expect(summary.totalWallLengthIn).toBe(0);
  });

  it("rejects non-documents", () => {
    expect(() => summarizeDesignForEstimating(null)).toThrow(/document/);
    expect(() => summarizeDesignForEstimating({ version: 1 })).toThrow(/document/);
  });

  it("totals pipe length by diameter and counts piping symbols", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 120, y: 0 }], { diameterIn: 2 });
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 60, y: 0 }], { diameterIn: 2 });
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 0, y: 96 }], { diameterIn: 4 });
    d = placeSymbol(d, "piping", "pump", 200, 200);
    d = placeSymbol(d, "piping", "gate-valve", 210, 210);
    const summary = summarizeDesignForEstimating(d);
    expect(summary.pipeRunCount).toBe(3);
    expect(summary.pipeLengthByDiameterIn).toEqual({ 2: 180, 4: 96 });
    expect(summary.pipeRuns).toHaveLength(3);
    expect(summary.pipeRuns[0].lengthIn).toBe(120);
    expect(summary.pipingSymbolCount).toBe(2);
  });

  it("summarizes an empty piping design as zeros", () => {
    const summary = summarizeDesignForEstimating(createEmptyDesign());
    expect(summary.pipeRunCount).toBe(0);
    expect(summary.pipeLengthByDiameterIn).toEqual({});
    expect(summary.pipingSymbolCount).toBe(0);
  });

  it("exposes no editor internals — only plain data", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 100, y: 0 });
    const summary = summarizeDesignForEstimating(d);
    const json = JSON.parse(JSON.stringify(summary));
    expect(json).toEqual(summary);
    expect(json).not.toHaveProperty("walls");
    expect(json).not.toHaveProperty("polygon");
  });
});
