// processEquipment3D.test.js — process equipment in the 3D view (model layer).

import { describe, expect, it } from "vitest";
import { createEmptyDesign, moveSymbol, placeSymbol } from "./designerDocument";
import { buildThreeScene, equipmentDescriptors, highlightKeysForSelection } from "./designerThreeModel";
import { beginDrag3D, dragStep3D, selectionFromPick, sizeFieldsForSelection } from "./designer3DEditing";

const D = "processEquipment";

function plant() {
  let d = createEmptyDesign("Plant");
  d = { ...d, settings: { ...d.settings, gridIn: 6 } };
  d = placeSymbol(d, D, "vertical-vessel", 100, 200, { tag: "V-101" });
  d = placeSymbol(d, D, "horizontal-drum", 300, 200, { tag: "V-102", rotationDeg: 90 });
  d = placeSymbol(d, D, "centrifugal-pump", 200, 300);
  d = placeSymbol(d, "piping", "gate-valve", 50, 50); // no 3D form
  return d;
}

describe("equipmentDescriptors", () => {
  it("emits one floor-standing primitive per process-equipment piece", () => {
    const eq = equipmentDescriptors(plant());
    expect(eq.map((e) => e.shape)).toEqual(["vcyl", "hcyl", "box"]);
    expect(eq[0]).toMatchObject({ x: 100, z: 200, widthIn: 48, depthIn: 48, heightIn: 120, tag: "V-101", rotY: -0 });
    expect(eq[1].rotY).toBeCloseTo(-Math.PI / 2);
  });

  it("is part of the scene, and the floor grows to include it", () => {
    const d = placeSymbol(createEmptyDesign(), D, "storage-tank", 1000, 1000);
    const scene = buildThreeScene(d);
    expect(scene.equipment).toHaveLength(1);
    expect(scene.floor.maxX).toBeGreaterThanOrEqual(1000 + 72);
  });
});

describe("3D selection and drag", () => {
  it("highlights and picks equipment as a 'symbol' selection", () => {
    expect(highlightKeysForSelection({ kind: "symbol", id: "s1" }, plant())).toEqual(["symbol:s1"]);
    expect(selectionFromPick({ entityKind: "symbol", entityId: "s1" })).toEqual({ kind: "symbol", id: "s1" });
  });

  it("drags a piece across the floor on the grid, as one coalesced move", () => {
    const d = plant();
    const pump = d.symbols[2];
    const drag = beginDrag3D({ kind: "symbol", id: pump.id }, d, { x: 205, y: 302 });
    const { action } = dragStep3D(drag, d, { x: 260, y: 351 });
    expect(action).toEqual({ type: "MOVE_SYMBOL", symbolId: pump.id, x: onGrid(255), y: onGrid(349), coalesce: `move-symbol:${pump.id}` });
    const moved = moveSymbol(d, pump.id, action.x, action.y).symbols[2];
    expect([moved.x, moved.y]).toEqual([action.x, action.y]);
  });

  it("has no size popup for equipment (sizes are catalog planning values)", () => {
    const d = plant();
    expect(sizeFieldsForSelection({ kind: "symbol", id: d.symbols[0].id }, d)).toBeNull();
  });
});

function onGrid(v) {
  return Math.round(v / 6) * 6;
}

describe("sphere shape", () => {
  it("builds the pressure sphere as a sphere primitive", () => {
    const d = placeSymbol(createEmptyDesign(), D, "pressure-sphere", 0, 0);
    expect(equipmentDescriptors(d)[0]).toMatchObject({ shape: "sphere", widthIn: 360, heightIn: 420 });
  });
});
