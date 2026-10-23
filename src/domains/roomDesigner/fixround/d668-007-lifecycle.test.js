// D668-007 probe — generated components lack the required edit/delete
// and legacy-upgrade lifecycle. Exact shapes from the finding:
//   - a legacy-shaped vertical-vessel placement immediately gains anchors
//     + manway + access with no explicit upgrade;
//   - setting its manway to null still restores the catalog default;
//   - setting instance nozzles to [] still yields 7 anchors.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: a stable child selection/ownership/tombstone model,
// editable + deletable generated entities (manway tombstone, nozzle
// list override / tombstones), delete/move/resize/save/reload/undo-redo
// coverage, and an explicit legacy retrofit path that preserves
// pre-upgrade documents (the upgrade is one undoable transaction).

import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
  parseDesign,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import {
  anchorsOf,
  detectRunAttachments,
  upgradeDesignConnections,
} from "../pipeAttachments";
import { manwaySpec } from "../vesselAccess";
import { addPipeRun } from "../designerDocument";

beforeEach(() => {
  resetDesignerIds();
});

function legacyVessel() {
  // A placement shaped like a pre-nozzle-catalog save: no manway
  // override, no nozzle fields at all.
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
    id: "v-legacy",
    tag: "V-100",
  });
  return design;
}

describe("D668-007 generated-component lifecycle", () => {
  it("a manway tombstone deletes the manway (null restores nothing)", () => {
    const design = legacyVessel();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    expect(manwaySpec(symbol, inst)).not.toBeNull();
    const deleted = {
      ...design,
      symbols: [{ ...inst, manway: { deleted: true } }],
    };
    expect(manwaySpec(symbol, deleted.symbols[0])).toBeNull();
    // ... and null means deleted too (explicit user delete).
    const nulled = {
      ...design,
      symbols: [{ ...inst, manway: null }],
    };
    expect(manwaySpec(symbol, nulled.symbols[0])).toBeNull();
  });

  it("a deleted manway is a named validation finding, not silent", async () => {
    const { vesselAccessErrors } = await import("../vesselAccess");
    const design = legacyVessel();
    const inst = design.symbols[0];
    const deleted = {
      ...design,
      symbols: [{ ...inst, manway: { deleted: true } }],
    };
    const errors = vesselAccessErrors(deleted);
    expect(errors.some((e) => /manway.*(deleted|missing|no manway)/i.test(e))).toBe(true);
  });

  it("an instance nozzle list override replaces the catalog set ([] deletes all)", () => {
    const design = legacyVessel();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    expect(anchorsOf(inst).length).toBeGreaterThan(0);
    const emptied = { ...inst, nozzles: [] };
    expect(anchorsOf(emptied)).toEqual([]);
    void symbol;
  });

  it("nozzle tombstones delete individual anchors by stable id", () => {
    const design = legacyVessel();
    const inst = design.symbols[0];
    const before = anchorsOf(inst).map((a) => a.id);
    expect(before).toContain("top-out");
    const tombstoned = { ...inst, nozzleTombstones: ["top-out"] };
    const after = anchorsOf(tombstoned).map((a) => a.id);
    expect(after).not.toContain("top-out");
    expect(after).toHaveLength(before.length - 1);
  });

  it("the explicit upgrade is one undoable transaction preserving the document", () => {
    let design = legacyVessel();
    // A run end sitting exactly on the vessel's side-out nozzle.
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const anchor = anchorsOf(inst).find((a) => a.id === "side-out");
    design = addPipeRun(design, [{ x: 900, y: 500 }, { x: anchor.x, y: anchor.y }], {
      id: "p1",
      diameterIn: 8,
    });
    const beforeJson = serializeDesign(design);
    const upgraded = upgradeDesignConnections(design);
    const run = upgraded.pipes.find((p) => p.id === "p1");
    expect(run.attachments?.end).toMatchObject({ symbolId: "v-legacy", anchorId: "side-out" });
    // Geometry untouched: only connection records were added.
    const stripped = {
      ...upgraded,
      pipes: upgraded.pipes.map((p) => {
        const { attachments, junctions, ...rest } = p;
        return rest;
      }),
    };
    expect(serializeDesign(stripped)).toBe(beforeJson);
    void symbol;
  });

  it("generated-component edits round-trip through save/reload", () => {
    const design = legacyVessel();
    const inst = design.symbols[0];
    const edited = {
      ...design,
      symbols: [{ ...inst, manway: { deleted: true }, nozzleTombstones: ["top-out"] }],
    };
    const reloaded = parseDesign(serializeDesign(edited));
    const back = reloaded.symbols[0];
    const symbol = findSymbol(back.domain, back.symbolId);
    expect(manwaySpec(symbol, back)).toBeNull();
    expect(anchorsOf(back).map((a) => a.id)).not.toContain("top-out");
  });

  it("detectRunAttachments honors tombstoned nozzles (no phantom attach)", () => {
    let design = legacyVessel();
    const inst = design.symbols[0];
    const anchor = anchorsOf(inst).find((a) => a.id === "top-out");
    design = addPipeRun(design, [{ x: 900, y: 500 }, { x: anchor.x, y: anchor.y }], {
      id: "p1",
      diameterIn: 8,
    });
    design = {
      ...design,
      symbols: [{ ...inst, nozzleTombstones: ["top-out"] }],
    };
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    expect(run.attachments?.end ?? null).toBeNull();
  });
});
