// D668-008 probe — D8/D9 authoring and repair workflows are largely
// seed-only. Exact shapes from the finding:
//   - ordinary pipe commands expose free-text service/diameter/elevation/
//     material but carry no semantic utility/source identities;
//   - firewater target/aim/station/boundary fields lack a complete
//     authoring path;
//   - a new vessel with zero utilities returns NO errors because the
//     D8-system guard disables checks when the system is absent;
//   - a downcomer temperature entered WITHOUT a unit defaults to F
//     (unit must be user-entered: blank/default-unknown until chosen).
//
// These probes FAIL against the current implementation and must PASS
// after the fix: real commands carrying semantic identities, missing-
// all-three AND partially-missing utility findings, 2"/1" defaults on
// newly authored utility runs, editable firewater sizes, unit-preserving
// temperature entry, and column-height changes updating body/levels/
// attachments consistently. No auto-routing.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { utilityPipingErrors } from "../utilityPiping";
import { setDowncomerLevelProps, downcomerLevelSpecs } from "../downcomers";
import { findSymbol } from "../symbolRegistry";
import { detectRunAttachments } from "../pipeAttachments";

beforeEach(() => {
  resetDesignerIds();
});

describe("D668-008 authoring: semantic identities on ordinary commands", () => {
  it("addPipeRun carries utility and sourceOf identities", async () => {
    const { addUtilityRun } = await import("../designerDocument");
    let design = createEmptyDesign();
    design = addUtilityRun(design, "plant-water", [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "uw-header",
      kind: "header",
    });
    const run = design.pipes.find((p) => p.id === "uw-header");
    expect(run.utility).toBe("plant-water");
    expect(run.diameterIn).toBe(2);
  });

  it("newly authored branch runs default to the 1-in drop size", async () => {
    const { addUtilityRun } = await import("../designerDocument");
    let design = createEmptyDesign();
    design = addUtilityRun(design, "nitrogen", [{ x: 0, y: 0 }, { x: 0, y: 60 }], {
      id: "uw-branch",
      kind: "branch",
    });
    expect(design.pipes.find((p) => p.id === "uw-branch").diameterIn).toBe(1);
  });

  it("a design can designate a pipe as a service source via command", async () => {
    const { setPipeSource } = await import("../designerDocument");
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "src" });
    design = setPipeSource(design, "src", "plant-water");
    expect(design.pipes.find((p) => p.id === "src").sourceOf).toBe("plant-water");
    design = setPipeSource(design, "src", null);
    expect(design.pipes.find((p) => p.id === "src").sourceOf).toBeUndefined();
  });

  it("a new vessel with ZERO utilities is flagged (missing all three)", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
      id: "v-new",
      tag: "V-900",
    });
    const errors = utilityPipingErrors(design);
    for (const service of ["Plant water", "Plant air", "Nitrogen"]) {
      expect(errors.some((e) => e.includes("V-900") && e.includes(service))).toBe(true);
    }
  });

  it("a partially connected vessel flags only the missing services", async () => {
    const { addUtilityRun, setPipeSource } = await import("../designerDocument");
    const { utilityAnchorsWorld } = await import("../utilityPiping");
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
      id: "v-part",
      tag: "V-901",
    });
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const port = utilityAnchorsWorld(symbol, inst).find((a) => a.id === "utility-plant-water");
    // Source + header + branch for plant water only.
    design = addUtilityRun(design, "plant-water", [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "pw-src",
      kind: "header",
    });
    design = setPipeSource(design, "pw-src", "plant-water");
    design = addUtilityRun(design, "plant-water", [{ x: 50, y: 0 }, { x: port.x, y: port.y }], {
      id: "pw-branch",
      kind: "branch",
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "pw-branch"
          ? {
              ...p,
              junctions: { start: { runId: "pw-src" } },
              attachments: { end: { symbolId: "v-part", anchorId: "utility-plant-water" } },
            }
          : p,
      ),
    };
    // R1/D3: the header-to-drop tap carries its modeled reducer —
    // without the bound transition the supply graph has no edge.
    const { placeReducer } = await import("../pipeReducerModel");
    design = placeReducer(design, 50, 0, {
      id: "pw-red",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: (Math.atan2(port.y - 0, port.x - 50) * 180) / Math.PI,
    });
    const errors = utilityPipingErrors(design);
    expect(errors.some((e) => e.includes("V-901") && e.includes("Plant water"))).toBe(false);
    expect(errors.some((e) => e.includes("V-901") && e.includes("Plant air"))).toBe(true);
    expect(errors.some((e) => e.includes("V-901") && e.includes("Nitrogen"))).toBe(true);
  });

  it("a firewater-only design does not demand the three D8 utilities", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
      id: "v-fw",
      tag: "V-902",
    });
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "fw",
      diameterIn: 12,
      utility: "firewater",
    });
    const errors = utilityPipingErrors(design).filter((e) => e.includes("V-902"));
    expect(errors).toEqual([]);
  });

  it("a downcomer temperature entered WITHOUT a unit keeps the unit unknown", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "t-1" });
    design = setDowncomerLevelProps(design, "t-1", 2, { temperature: 350 });
    const inst = design.symbols.find((s) => s.id === "t-1");
    expect(inst.downcomerProps["2"].temperature).toBe(350);
    // NOT defaulted to F: the unit is user-entered, blank until chosen.
    expect(inst.downcomerProps["2"].temperatureUnit ?? null).toBeNull();
  });

  it("an explicit unit is stored; zero is a valid entered temperature", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "t-1" });
    design = setDowncomerLevelProps(design, "t-1", 2, { temperature: 0, temperatureUnit: "C" });
    const inst = design.symbols.find((s) => s.id === "t-1");
    expect(inst.downcomerProps["2"]).toMatchObject({ temperature: 0, temperatureUnit: "C" });
  });

  it("column height changes update body, levels, and attachments consistently", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "t-1" });
    const symbol = findSymbol("processEquipment", "column");
    let inst = design.symbols.find((s) => s.id === "t-1");
    expect(downcomerLevelSpecs(symbol, inst)).toHaveLength(3);
    // Shrink to 240 in: level 3 goes away, levels 1-2 keep their ids.
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "t-1" ? { ...s, heightIn: 240 } : s)),
    };
    inst = design.symbols.find((s) => s.id === "t-1");
    expect(downcomerLevelSpecs(symbol, inst).map((l) => l.index)).toEqual([1, 2]);
    // A run attached to the surviving level-2 draw stays attached.
    const anchors = downcomerLevelSpecs(symbol, inst);
    void anchors;
    design = addPipeRun(design, [{ x: 1000, y: 0 }, { x: -18, y: 0 }], {
      id: "draw",
      diameterIn: 6,
      elevationIn: 240,
    });
    design = detectRunAttachments(design, "draw");
    expect(design.pipes.find((p) => p.id === "draw").attachments?.end?.anchorId).toBe(
      "downcomer-2-draw",
    );
  });
});
