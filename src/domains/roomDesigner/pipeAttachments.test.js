// pipeAttachments.test.js — pipe ends that stay on equipment nozzles.

import { describe, expect, it } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  deleteSymbol,
  moveSymbol,
  parseDesign,
  placeSymbol,
  rotateSymbol,
  serializeDesign,
  validateDesign,
} from "./designerDocument";
import { findSymbol } from "./symbolRegistry";
import { temaAnchorsWorld } from "./temaGeometry";
import { nearestConnectionAnchor, setSymbolDrawingMode, setSymbolSize, setSymbolTemaConfig } from "./temaInstances";
import { TEMA_PRESETS } from "./temaTypes";
import {
  anchorAtPoint,
  anchorsOf,
  detectRunAttachments,
  pipeAttachmentErrors,
  reconcilePipeAttachments,
} from "./pipeAttachments";
import { PROCESS_EQUIPMENT } from "./processEquipmentCatalog";

const D = "processEquipment";
const hx = () => findSymbol(D, "tema-exchanger");
const anchor = (design, id, symbolId = "hx") =>
  temaAnchorsWorld(hx(), design.symbols.find((s) => s.id === symbolId)).find((a) => a.id === id);

/** Exchanger "hx" (H shell: 4 shell nozzles) with a pipe from its tube inlet up to (0, -200). */
function piped(config = { front: "A", shell: "H", rear: "S", tubePasses: 2 }) {
  let design = placeSymbol(createEmptyDesign(), D, "tema-exchanger", 300, 200, { id: "hx" });
  design = setSymbolTemaConfig(design, "hx", config);
  const a = anchor(design, "tube-in");
  design = addPipeRun(design, [{ x: a.x, y: a.y }, { x: a.x, y: -200 }], { id: "p1" });
  return detectRunAttachments(design, "p1");
}
const run = (design) => design.pipes.find((p) => p.id === "p1");

describe("detecting attachments", () => {
  it("attaches an end that sits exactly on a nozzle, and only the ends", () => {
    const design = piped();
    expect(run(design).attachments).toEqual({ start: { symbolId: "hx", anchorId: "tube-in" } });
    const a = anchor(design, "shell-in");
    const b = anchor(design, "shell-out");
    let two = addPipeRun(design, [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }], { id: "p2" });
    two = detectRunAttachments(two, "p2");
    expect(two.pipes[1].attachments).toEqual({
      start: { symbolId: "hx", anchorId: "shell-in" },
      end: { symbolId: "hx", anchorId: "shell-out" },
    });
  });

  it("leaves runs that touch no nozzle without an attachments field", () => {
    let design = addPipeRun(createEmptyDesign(), [{ x: 0, y: 0 }, { x: 50, y: 0 }], { id: "p1" });
    design = detectRunAttachments(design, "p1");
    expect("attachments" in run(design)).toBe(false);
    expect(anchorAtPoint(design, { x: 0, y: 0 })).toBeNull();
  });
});

describe("keeping attached ends on their nozzles", () => {
  const follows = (design) => {
    const a = anchor(design, "tube-in");
    expect(run(design).points[0].x).toBeCloseTo(a.x, 9);
    expect(run(design).points[0].y).toBeCloseTo(a.y, 9);
    expect(run(design).points[1]).toEqual({ x: run(piped()).points[1].x, y: -200 }); // free end untouched
  };

  it("follows a move", () => follows(reconcilePipeAttachments(moveSymbol(piped(), "hx", 360, 260))));
  it("follows a rotation", () => follows(reconcilePipeAttachments(rotateSymbol(piped(), "hx", 90))));
  it("follows a resize", () => follows(reconcilePipeAttachments(setSymbolSize(piped(), "hx", { widthIn: 300, depthIn: 60 }))));
  it("follows a configuration change that keeps the nozzle", () =>
    follows(reconcilePipeAttachments(setSymbolTemaConfig(piped(), "hx", TEMA_PRESETS.BEU))));

  it("does not move on a drawing-mode switch (same anchors)", () => {
    const design = piped();
    expect(reconcilePipeAttachments(setSymbolDrawingMode(design, "hx", "pid")).pipes).toEqual(design.pipes);
  });

  it("returns the same design object when nothing needs to move", () => {
    const design = piped();
    expect(reconcilePipeAttachments(design)).toBe(design);
    const plain = createEmptyDesign();
    expect(reconcilePipeAttachments(plain)).toBe(plain);
  });

  it("leaves the end in place and drops the link when the equipment is deleted", () => {
    const design = piped();
    const after = reconcilePipeAttachments(deleteSymbol(design, "hx"));
    expect(run(after).points).toEqual(run(design).points);
    expect("attachments" in run(after)).toBe(false);
  });

  it("leaves the end in place and drops the link when the nozzle disappears", () => {
    let design = piped();
    const a = anchor(design, "shell-in-2"); // only the H shell has it
    design = detectRunAttachments(addPipeRun(design, [{ x: a.x, y: a.y }, { x: a.x, y: -300 }], { id: "p2" }), "p2");
    const before = design.pipes[1].points;
    const after = reconcilePipeAttachments(setSymbolTemaConfig(design, "hx", TEMA_PRESETS.AES)); // E shell
    expect(after.pipes[1].points).toEqual(before);
    expect("attachments" in after.pipes[1]).toBe(false);
    expect(run(after).attachments).toEqual({ start: { symbolId: "hx", anchorId: "tube-in" } }); // still exists
  });
});

describe("persistence and validation", () => {
  it("survives save/reopen with no version bump and validates", () => {
    const design = piped();
    const reopened = parseDesign(serializeDesign(design));
    expect(reopened.version).toBe(1);
    expect(run(reopened).attachments).toEqual({ start: { symbolId: "hx", anchorId: "tube-in" } });
    expect(validateDesign(reopened)).toEqual([]);
  });

  it("flags malformed attachment metadata", () => {
    expect(pipeAttachmentErrors({ id: "p", attachments: { start: { symbolId: "hx" } } })[0]).toMatch(/malformed/);
    expect(pipeAttachmentErrors({ id: "p", attachments: { middle: { symbolId: "hx", anchorId: "a" } } })[0]).toMatch(/malformed/);
    expect(pipeAttachmentErrors({ id: "p", attachments: "hx" })[0]).toMatch(/malformed/);
    expect(pipeAttachmentErrors({ id: "p" })).toEqual([]);
  });
});

describe("catalog nozzle anchors", () => {
  const pumpAnchor = (design, id, symbolId = "pump1") =>
    anchorsOf(design.symbols.find((s) => s.id === symbolId)).find((a) => a.id === id);

  /** Centrifugal pump "pump1" at (200, 200) with a pipe from its suction nozzle to (200, 0). */
  function pipedPump() {
    let design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 200, 200, { id: "pump1" });
    const a = pumpAnchor(design, "suction-in");
    design = addPipeRun(design, [{ x: a.x, y: a.y }, { x: a.x, y: 0 }], { id: "p1" });
    return detectRunAttachments(design, "p1");
  }

  it("anchorsOf projects a catalog nozzle to world with its sizeIn", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 200, 200, { id: "pump1" });
    // Pump footprint 36 x 18: suction-in is (0, -1) -> (200, 200 - 9).
    expect(pumpAnchor(design, "suction-in")).toEqual({ id: "suction-in", x: 200, y: 191, sizeIn: 4 });
    expect(pumpAnchor(design, "discharge-out")).toEqual({ id: "discharge-out", x: 200, y: 209, sizeIn: 6 });
  });

  it("anchorAtPoint finds a catalog nozzle on a placed instance", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 200, 200, { id: "pump1" });
    const a = pumpAnchor(design, "suction-in");
    expect(anchorAtPoint(design, { x: a.x, y: a.y })).toEqual({ symbolId: "pump1", anchorId: "suction-in" });
  });

  it("detectRunAttachments attaches a run end placed exactly on a catalog nozzle, and only that end", () => {
    const design = pipedPump();
    expect(run(design).attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
  });

  it("detectRunAttachments attaches a run end on a column nozzle", () => {
    let design = placeSymbol(createEmptyDesign(), D, "column", 400, 300, { id: "col1" });
    const a = anchorsOf(design.symbols.find((s) => s.id === "col1")).find((n) => n.id === "feed-in");
    // Column footprint 36 x 36: feed-in is (-1, 0) -> (400 - 18, 300).
    expect(a).toEqual({ id: "feed-in", x: 382, y: 300, sizeIn: 16 });
    design = addPipeRun(design, [{ x: 0, y: 300 }, { x: a.x, y: a.y }], { id: "p1" });
    design = detectRunAttachments(design, "p1");
    expect(run(design).attachments).toEqual({ end: { symbolId: "col1", anchorId: "feed-in" } });
  });

  it("reconcilePipeAttachments follows a moved catalog-nozzled symbol", () => {
    const moved = reconcilePipeAttachments(moveSymbol(pipedPump(), "pump1", 260, 240));
    const a = pumpAnchor(moved, "suction-in");
    expect(run(moved).points[0].x).toBeCloseTo(a.x, 9);
    expect(run(moved).points[0].y).toBeCloseTo(a.y, 9);
    expect(run(moved).points[1]).toEqual({ x: 200, y: 0 }); // free end untouched
    expect(run(moved).attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
  });

  it("reconcilePipeAttachments follows a rotated catalog-nozzled symbol", () => {
    const rotated = reconcilePipeAttachments(rotateSymbol(pipedPump(), "pump1", 90));
    const a = pumpAnchor(rotated, "suction-in");
    expect(run(rotated).points[0].x).toBeCloseTo(a.x, 9);
    expect(run(rotated).points[0].y).toBeCloseTo(a.y, 9);
    expect(run(rotated).points[1]).toEqual({ x: 200, y: 0 }); // free end untouched
  });

  it("instance size overrides move catalog anchors", () => {
    const design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 200, 200, {
      id: "pump1",
      widthIn: 72,
      depthIn: 36,
    });
    // Doubled footprint: suction-in (0, -1) -> (200, 200 - 18).
    expect(pumpAnchor(design, "suction-in")).toEqual({ id: "suction-in", x: 200, y: 182, sizeIn: 4 });
    expect(pumpAnchor(design, "discharge-out")).toEqual({ id: "discharge-out", x: 200, y: 218, sizeIn: 6 });
  });

  it("a symbol type without nozzles yields no anchors and no attachments", () => {
    let design = placeSymbol(createEmptyDesign(), D, "storage-tank", 200, 200, { id: "tank1" });
    expect(anchorsOf(design.symbols.find((s) => s.id === "tank1"))).toEqual([]);
    design = addPipeRun(design, [{ x: 200, y: 200 }, { x: 200, y: 0 }], { id: "p1" });
    design = detectRunAttachments(design, "p1");
    expect("attachments" in run(design)).toBe(false);
  });

  describe("runs created through the canvas snap query (nearestConnectionAnchor)", () => {
    const pumpAnchor2 = (design, id) =>
      anchorsOf(design.symbols.find((s) => s.id === "pump1")).find((a) => a.id === id);

    /**
     * Pump "pump1" at (101, 103) with a pipe whose start comes from the
     * ACTUAL canvas snap helper: a nearby off-grid pointer (103.3, 91.8)
     * must land exactly on the suction nozzle (101, 94).
     */
    function snappedPump() {
      let design = placeSymbol(createEmptyDesign(), D, "centrifugal-pump", 101, 103, { id: "pump1" });
      const snapped = nearestConnectionAnchor(design, { x: 103.3, y: 91.8 }, 12);
      expect(snapped).toMatchObject({ symbolInstanceId: "pump1", anchorId: "suction-in", x: 101, y: 94 });
      design = addPipeRun(design, [{ x: snapped.x, y: snapped.y }, { x: 300, y: 300 }], { id: "p1" });
      return detectRunAttachments(design, "p1");
    }

    it("produces attachment metadata for the snapped end, and only that end", () => {
      const design = snappedPump();
      expect(run(design).points[0]).toEqual({ x: 101, y: 94 });
      expect(run(design).attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
    });

    const followsSnap = (design) => {
      const a = pumpAnchor2(design, "suction-in");
      expect(run(design).points[0].x).toBeCloseTo(a.x, 9);
      expect(run(design).points[0].y).toBeCloseTo(a.y, 9);
      expect(run(design).points[1]).toEqual({ x: 300, y: 300 }); // free end untouched
      expect(run(design).attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
    };

    it("follows a move", () => followsSnap(reconcilePipeAttachments(moveSymbol(snappedPump(), "pump1", 161, 143))));
    it("follows a rotation", () => followsSnap(reconcilePipeAttachments(rotateSymbol(snappedPump(), "pump1", 90))));
    it("follows a resize", () =>
      followsSnap(reconcilePipeAttachments(setSymbolSize(snappedPump(), "pump1", { widthIn: 72, depthIn: 36 }))));

    it("detaches, end left in place, when the snapped-to equipment is deleted", () => {
      const design = snappedPump();
      const after = reconcilePipeAttachments(deleteSymbol(design, "pump1"));
      expect(run(after).points).toEqual(run(design).points);
      expect("attachments" in run(after)).toBe(false);
    });
  });

  it("catalog nozzle specs are sane: fx/fy in [-1, 1], sizeIn > 0, ids unique per symbol", () => {
    const withNozzles = PROCESS_EQUIPMENT.filter((e) => e.nozzles);
    expect(withNozzles.map((e) => e.id).sort()).toEqual([
      "absorber",
      "blower",
      "catalyst-regenerator",
      "centrifugal-compressor",
      "centrifugal-pump",
      "column",
      "flare-stack",
      "fluidized-bed-reactor",
      "horizontal-drum",
      "knockout-drum",
      "shell-tube-exchanger",
    ]);
    for (const e of withNozzles) {
      expect(new Set(e.nozzles.map((n) => n.id)).size).toBe(e.nozzles.length);
      for (const n of e.nozzles) {
        expect(n.fx).toBeGreaterThanOrEqual(-1);
        expect(n.fx).toBeLessThanOrEqual(1);
        expect(n.fy).toBeGreaterThanOrEqual(-1);
        expect(n.fy).toBeLessThanOrEqual(1);
        expect(n.sizeIn).toBeGreaterThan(0);
      }
    }
  });
});
