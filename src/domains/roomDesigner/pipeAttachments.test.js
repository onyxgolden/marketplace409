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
import { setSymbolDrawingMode, setSymbolSize, setSymbolTemaConfig } from "./temaInstances";
import { TEMA_PRESETS } from "./temaTypes";
import {
  anchorAtPoint,
  detectRunAttachments,
  pipeAttachmentErrors,
  reconcilePipeAttachments,
} from "./pipeAttachments";

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
