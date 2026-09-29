// DesignerViewport3D.rack.test.js — pipe racks and sleeper racks build as
// real structural members (plain Three.js, no DOM/WebGL).

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildEquipmentGroup } from "./DesignerViewport3D";
import { rackMembers3D, rackParams, rackTopIn } from "@/domains/roomDesigner/rackGeometry";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import "@/domains/roomDesigner/processEquipmentCatalog";

const stdMaterial = (opts) => new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 0.8 });
const shadowed = (m) => m;
const meshes = (g) => {
  const out = [];
  g.traverse((o) => o.isMesh && out.push(o));
  return out;
};

function eqFor(symbolId, inst = {}) {
  const symbol = findSymbol("processEquipment", symbolId);
  const p = rackParams(symbol, inst);
  return { shape: "rack", widthIn: p.lengthIn, depthIn: p.widthIn, heightIn: rackTopIn(p), color: "#94a3b8", tag: "PR-1", symbolId, members: rackMembers3D(p) };
}

describe("rack 3D", () => {
  it("pipe rack: one mesh per member, steel columns reach the top tier, braces tilted 45°", () => {
    const eq = eqFor("pipe-rack", { rack: { tiers: 3 } });
    const g = buildEquipmentGroup(eq, { stdMaterial, shadowed, makeLabel: null });
    const ms = meshes(g);
    expect(ms).toHaveLength(eq.members.length);
    const cols = ms.filter((m) => m.userData.rackMember === "column");
    expect(cols).toHaveLength(6);
    const top = Math.max(...cols.map((c) => c.position.y + c.geometry.parameters.height / 2));
    expect(top).toBeCloseTo(eq.heightIn);
    const braces = ms.filter((m) => m.userData.rackMember === "brace");
    expect(braces.every((b) => Math.abs(Math.abs(b.rotation.x) - Math.PI / 4) < 1e-9)).toBe(true);
  });

  it("sleeper rack: sleepers in steel, piers in concrete", () => {
    const g = buildEquipmentGroup(eqFor("sleeper-rack"), { stdMaterial, shadowed, makeLabel: null });
    const ms = meshes(g);
    const piers = ms.filter((m) => m.userData.rackMember === "pier");
    const sleepers = ms.filter((m) => m.userData.rackMember === "sleeper");
    expect(piers.length).toBe(10);
    expect(sleepers.length).toBe(5);
    expect(piers[0].material.color.getHexString()).toBe("9ca3af");
    expect(sleepers[0].material.color.getHexString()).toBe("94a3b8");
  });
});

describe("camera framing with a tall rack", () => {
  it("starts outside the rack, looking at the model", async () => {
    const { frameCameraOnModel } = await import("./DesignerViewport3D");
    const { buildThreeScene } = await import("@/domains/roomDesigner/designerThreeModel");
    const { createEmptyDesign, placeSymbol, addPipeRun } = await import("@/domains/roomDesigner/designerDocument");
    const { setRackParams } = await import("@/domains/roomDesigner/rackGeometry");
    let d = placeSymbol(createEmptyDesign("R"), "processEquipment", "pipe-rack", 300, 160, { id: "pr" });
    d = setRackParams(d, "pr", { tiers: 5, elevationIn: 360, tierSpacingIn: 96 }); // 62 ft top of steel
    d = addPipeRun(d, [{ x: 40, y: 120 }, { x: 560, y: 120 }]);
    const built = buildThreeScene(d);
    const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 1e7);
    const controls = { target: new THREE.Vector3(), update() {} };
    expect(frameCameraOnModel(cam, controls, built)).toBe(true);
    const rack = built.equipment.find((e) => e.id === "pr");
    const inside =
      Math.abs(cam.position.x - rack.x) < rack.widthIn / 2 &&
      Math.abs(cam.position.z - rack.z) < rack.depthIn / 2 &&
      cam.position.y < rack.heightIn;
    expect(inside).toBe(false);
    expect(cam.position.y).toBeGreaterThan(rack.heightIn); // above the top tier, looking down
  });
});
