// DesignerViewport3D.viewCube.test.js — pure camera math behind the ViewCube
// gizmo (the actual "TrueView 360 toggle" control): reading the camera's
// current spherical offset from its orbit target, applying a new one, and
// the three ways the gizmo can change it (compass snap, face-normal snap,
// drag-to-orbit). Same convention as the other DesignerViewport3D.*.test.js
// files: real Three.js objects, NO React, NO DOM, NO WebGL context.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applySphericalToCamera,
  COMPASS_AZIMUTH,
  orbitCameraByDrag,
  snapToCompassDirection,
  snapToFaceNormal,
  sphericalFromCamera,
} from "./DesignerViewport3D";

const rig = () => ({
  camera: new THREE.PerspectiveCamera(50, 1, 1, 24000),
  controls: { target: new THREE.Vector3(), update() {} },
});

describe("sphericalFromCamera", () => {
  it("reads radius, azimuth, and polar angle from a camera positioned above and to the side of its target", () => {
    const target = new THREE.Vector3(10, 0, 10);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 100, 110); // straight "north" (+Z) and up from target
    const { radius, azimuth, polar } = sphericalFromCamera(camera, target);
    expect(radius).toBeCloseTo(Math.hypot(0, 100, 100));
    expect(azimuth).toBeCloseTo(0); // dx=0, dz=100 -> atan2(0,100) = 0, matches COMPASS_AZIMUTH.N
    expect(polar).toBeGreaterThan(0);
    expect(polar).toBeLessThan(Math.PI / 2);
  });

  it("round-trips through applySphericalToCamera", () => {
    const target = new THREE.Vector3(5, 5, 5);
    const camera = new THREE.PerspectiveCamera();
    const spherical = { radius: 200, azimuth: 1.1, polar: 0.9 };
    applySphericalToCamera(camera, { target: new THREE.Vector3(), update() {} }, target, spherical);
    const back = sphericalFromCamera(camera, target);
    expect(back.radius).toBeCloseTo(spherical.radius);
    expect(back.azimuth).toBeCloseTo(spherical.azimuth);
    expect(back.polar).toBeCloseTo(spherical.polar);
  });
});

describe("applySphericalToCamera", () => {
  it("re-targets the controls' target to the given point", () => {
    const { camera, controls } = rig();
    applySphericalToCamera(camera, controls, { x: 3, y: 4, z: 5 }, { radius: 100, azimuth: 0, polar: 1 });
    expect(controls.target.x).toBeCloseTo(3);
    expect(controls.target.y).toBeCloseTo(4);
    expect(controls.target.z).toBeCloseTo(5);
  });

  it("tolerates controls with no target (a bare rig)", () => {
    const camera = new THREE.PerspectiveCamera();
    expect(() => applySphericalToCamera(camera, {}, { x: 0, y: 0, z: 0 }, { radius: 100, azimuth: 0, polar: 1 })).not.toThrow();
  });
});

describe("snapToCompassDirection", () => {
  it("changes azimuth to the compass direction while preserving radius and tilt", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 300, azimuth: 2.4, polar: 0.7 });
    snapToCompassDirection(camera, controls, target, "E");
    const after = sphericalFromCamera(camera, target);
    expect(after.azimuth).toBeCloseTo(COMPASS_AZIMUTH.E);
    expect(after.radius).toBeCloseTo(300);
    expect(after.polar).toBeCloseTo(0.7);
  });

  it("returns false and does nothing for an unknown direction", () => {
    const { camera, controls } = rig();
    const before = camera.position.clone();
    expect(snapToCompassDirection(camera, controls, { x: 0, y: 0, z: 0 }, "NE")).toBe(false);
    expect(camera.position.equals(before)).toBe(true);
  });

  it("covers all four compass directions with distinct azimuths", () => {
    const azimuths = new Set(Object.values(COMPASS_AZIMUTH));
    expect(azimuths.size).toBe(4);
  });
});

describe("snapToFaceNormal", () => {
  it("looks near-straight down for the +Y (top) face (clamped just short of true gimbal lock)", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 500, azimuth: 1, polar: 1 });
    snapToFaceNormal(camera, controls, target, new THREE.Vector3(0, 1, 0));
    // Not exactly overhead: the polar angle is clamped away from a true 0
    // (see MIN_POLAR), so this settles a fraction below full height, with a
    // small horizontal offset along whichever axis atan2(0, 0) resolves the
    // azimuth to (implementation detail — this asserts "small," not "zero").
    expect(camera.position.y).toBeGreaterThan(499);
    expect(camera.position.y).toBeLessThanOrEqual(500);
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan(30);
  });

  it("looks from +X (right) at the current radius", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 250, azimuth: 0, polar: 1.2 });
    snapToFaceNormal(camera, controls, target, new THREE.Vector3(1, 0, 0));
    const after = sphericalFromCamera(camera, target);
    expect(after.radius).toBeCloseTo(250);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.y).toBeCloseTo(0, 1);
    expect(camera.position.z).toBeCloseTo(0, 1);
  });
});

describe("orbitCameraByDrag", () => {
  it("dragging right (+dx) changes azimuth", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 300, azimuth: 0, polar: 1 });
    const before = sphericalFromCamera(camera, target).azimuth;
    orbitCameraByDrag(camera, controls, target, 50, 0);
    const after = sphericalFromCamera(camera, target).azimuth;
    expect(after).not.toBeCloseTo(before);
  });

  it("dragging up/down changes polar angle but stays within the clamp", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 300, azimuth: 0, polar: Math.PI / 2 });
    orbitCameraByDrag(camera, controls, target, 0, -100000, 0.01); // an extreme drag
    const after = sphericalFromCamera(camera, target).polar;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(Math.PI);
  });

  it("preserves radius across a drag", () => {
    const { camera, controls } = rig();
    const target = { x: 0, y: 0, z: 0 };
    applySphericalToCamera(camera, controls, target, { radius: 175, azimuth: 0.3, polar: 1.1 });
    orbitCameraByDrag(camera, controls, target, 20, -10);
    expect(sphericalFromCamera(camera, target).radius).toBeCloseTo(175);
  });
});
