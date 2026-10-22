// DesignerViewport3D.pipe.test.js — pipe runs build as 3D meshes (plain
// Three.js, no DOM/WebGL), modeled on DesignerViewport3D.rack.test.js:
// the scene descriptor from the pure model layer feeds the exported
// group builder, and the group registers under "pipe:<id>".

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyHighlight, buildPipeGroup, frameCameraOnModel } from "./DesignerViewport3D";
import { buildThreeScene, highlightRegistryKey } from "@/domains/roomDesigner/designerThreeModel";
import { addPipeRun, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";

const stdMaterial = (opts) => new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 0.8 });
const shadowed = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
const meshes = (g) => {
  const out = [];
  g.traverse((o) => o.isMesh && out.push(o));
  return out;
};
const cylinders = (g) => meshes(g).filter((m) => m.geometry.type === "CylinderGeometry");
const spheres = (g) => meshes(g).filter((m) => m.geometry.type === "SphereGeometry");

function gradeDesign() {
  // Two segments at grade, no rack: 2 segment cylinders + 3 joint spheres.
  return addPipeRun(createEmptyDesign("P"), [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }], {
    id: "p1",
    diameterIn: 4,
  });
}

describe("pipe 3D", () => {
  it("builds one cylinder per segment and one sphere per joint, in world space", () => {
    const built = buildThreeScene(gradeDesign());
    expect(built.pipes).toHaveLength(1);
    const g = buildPipeGroup(built.pipes[0], { stdMaterial, shadowed });
    expect(meshes(g)).toHaveLength(5);
    expect(cylinders(g)).toHaveLength(2);
    expect(spheres(g)).toHaveLength(3);

    // Segment cylinders run between their 3D endpoints at elevation 30:
    // first along x from (0,30,0) to (120,30,0), second along z.
    const [segA, segB] = cylinders(g);
    expect(segA.position.x).toBeCloseTo(60);
    expect(segA.position.y).toBeCloseTo(30);
    expect(segA.position.z).toBeCloseTo(0);
    expect(segA.geometry.parameters.height).toBeCloseTo(120);
    expect(segA.geometry.parameters.radiusTop).toBeCloseTo(2); // 4 in diameter
    expect(segB.position.x).toBeCloseTo(120);
    expect(segB.position.y).toBeCloseTo(30);
    expect(segB.position.z).toBeCloseTo(60);

    // Joint spheres sit on the run's vertices (plan y -> z).
    const jointPositions = spheres(g).map((s) => [s.position.x, s.position.y, s.position.z]);
    expect(jointPositions).toEqual([
      [0, 30, 0],
      [120, 30, 0],
      [120, 30, 120],
    ]);
    for (const s of spheres(g)) expect(s.geometry.parameters.radius).toBeCloseTo(2);

    // Every mesh draws in the descriptor's color and casts/receives shadow.
    for (const m of meshes(g)) {
      expect(m.material.color.getHexString()).toBe("7dd3fc");
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it("builds a vertical riser cylinder where a run drops from a rack to grade", () => {
    let d = placeSymbol(createEmptyDesign("P"), "processEquipment", "pipe-rack", 300, 160, { id: "pr" });
    d = addPipeRun(d, [{ x: 100, y: 160 }, { x: 400, y: 160 }, { x: 700, y: 160 }], { id: "p2" });
    const built = buildThreeScene(d);
    expect(built.pipes[0].risers).toHaveLength(1);
    const g = buildPipeGroup(built.pipes[0], { stdMaterial, shadowed });
    // 2 segments + 1 riser = 3 cylinders; 3 joints = 3 spheres.
    expect(cylinders(g)).toHaveLength(3);
    expect(spheres(g)).toHaveLength(3);
    const riser = cylinders(g).find((c) => c.position.x === 400 && c.position.z === 160);
    expect(riser).toBeDefined();
    expect(riser.geometry.parameters.height).toBeCloseTo(151); // 181 - 30
    expect(riser.position.y).toBeCloseTo(105.5); // midpoint of 30..181
    // Rack-supported segment rides at 181, grade segment at 30.
    const segYs = cylinders(g)
      .filter((c) => c !== riser)
      .map((c) => c.position.y)
      .sort((a, b) => a - b);
    expect(segYs).toEqual([30, 181]);
  });

  it("tags the group as its pipe run and registers it under pipe:<id> for highlighting", () => {
    const design = gradeDesign();
    const built = buildThreeScene(design);
    const g = buildPipeGroup(built.pipes[0], { stdMaterial, shadowed });
    expect(g.userData.entityKind).toBe("pipe");
    expect(g.userData.entityId).toBe("p1");

    // Registered exactly the way the scene-build effect registers it.
    const key = highlightRegistryKey("pipe", built.pipes[0].id);
    expect(key).toBe("pipe:p1");
    const registryRef = { current: new Map([[key, [g]]]) };
    const highlightedRef = { current: [] };
    applyHighlight({ kind: "pipe", id: "p1" }, design, registryRef, highlightedRef);

    // Every mesh in the group is tinted — the selection found the group
    // through the pipe key, with no scene rebuild.
    expect(highlightedRef.current).toHaveLength(meshes(g).length);
    for (const m of meshes(g)) expect(m.material.emissive.getHex()).toBe(0x2dd4bf);
  });

  it("clears the pipe highlight when the selection clears (P661-002)", () => {
    const design = gradeDesign();
    const built = buildThreeScene(design);
    const g = buildPipeGroup(built.pipes[0], { stdMaterial, shadowed });
    const original = meshes(g)[0].material;
    const registryRef = { current: new Map([[highlightRegistryKey("pipe", "p1"), [g]]]) };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "pipe", id: "p1" }, design, registryRef, highlightedRef);
    expect(highlightedRef.current.length).toBeGreaterThan(0);
    applyHighlight(null, design, registryRef, highlightedRef);
    expect(highlightedRef.current).toEqual([]);
    for (const m of meshes(g)) expect(m.material).toBe(original);
  });
});

describe("frameCameraOnModel — pipes (P661-001)", () => {
  const rig = () => ({
    camera: new THREE.PerspectiveCamera(50, 1, 1, 24000),
    controls: { target: new THREE.Vector3(), update() {} },
  });

  it("frames a pipes-only design far from the origin through the real helper", () => {
    let d = addPipeRun(createEmptyDesign("P"), [{ x: 10000, y: 10000 }, { x: 11000, y: 10000 }], {
      id: "far",
      diameterIn: 4,
    });
    const built = buildThreeScene(d);
    const { camera, controls } = rig();
    expect(frameCameraOnModel(camera, controls, built)).toBe(true);
    // Floor center is the pipe's center; floor size 1052 dominates framing.
    expect(controls.target.x).toBeCloseTo(10500);
    expect(controls.target.z).toBeCloseTo(10000);
    expect(camera.position.x).toBeCloseTo(10500 + 1052 * 0.55);
    expect(camera.position.y).toBeCloseTo(1052 * 0.75);
    expect(camera.position.z).toBeCloseTo(10000 + 1052 * 0.55);
  });

  it("returns false for an empty design through the real helper", () => {
    const built = buildThreeScene(createEmptyDesign("P"));
    expect(built.floor).toBeNull();
    const { camera, controls } = rig();
    const before = camera.position.clone();
    expect(frameCameraOnModel(camera, controls, built)).toBe(false);
    expect(camera.position.equals(before)).toBe(true);
  });

  it("counts pipe elevation toward the vertical frame", () => {
    const built = {
      floor: { minX: 0, minZ: 0, maxX: 200, maxZ: 200 },
      equipment: [],
      pipes: [
        {
          radiusIn: 2,
          segments: [{ a: { x: 0, z: 0 }, b: { x: 100, z: 0 }, yIn: 600 }],
          joints: [],
          risers: [],
        },
      ],
    };
    const { camera, controls } = rig();
    expect(frameCameraOnModel(camera, controls, built)).toBe(true);
    // Pipe top 602; frame = max(200, 602 * 1.8) = 1083.6
    expect(camera.position.y).toBeCloseTo(1083.6 * 0.75);
    expect(controls.target.y).toBeCloseTo(Math.min(602, 240) * 0.3); // floorSize floors at 240
  });
});
