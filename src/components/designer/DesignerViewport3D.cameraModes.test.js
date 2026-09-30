// DesignerViewport3D.cameraModes.test.js — pure logic behind Walk/Fly/
// Dollhouse: starting camera pose, dollhouse framing, and the per-frame
// first-person movement integrator. Same convention as
// DesignerViewport3D.equipment.test.js: real Three.js objects where useful,
// NO React, NO DOM, NO WebGL context.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  computeFlyStep,
  DOLLHOUSE_POLAR_RANGE,
  frameDollhouseOnModel,
  resetFirstPersonInputState,
  SPRINT_MAX_MULTIPLIER,
  SPRINT_RAMP_SECONDS,
  sprintMultiplier,
  walkStartPose,
  WALK_EYE_HEIGHT_IN,
} from "./DesignerViewport3D";

describe("walkStartPose", () => {
  const built = { floor: { minX: 0, minZ: 0, maxX: 1000, maxZ: 800 } };

  it("starts at the floor's center, at the given eye height, offset toward one edge", () => {
    const pose = walkStartPose(built, { heightIn: 66 });
    expect(pose.position).toEqual({ x: 500, y: 66, z: 400 + 800 * 0.3 });
    expect(pose.lookAt).toEqual({ x: 500, y: 66, z: 400 - 800 * 0.3 });
  });

  it("defaults to WALK_EYE_HEIGHT_IN when no height is given", () => {
    const pose = walkStartPose(built);
    expect(pose.position.y).toBe(WALK_EYE_HEIGHT_IN);
  });

  it("looks back across the floor it starts on, never at its own spawn point", () => {
    const pose = walkStartPose(built, { heightIn: 96 });
    expect(pose.lookAt.z).not.toBe(pose.position.z);
  });

  it("returns null when there is no floor to stand on", () => {
    expect(walkStartPose({ floor: null })).toBeNull();
    expect(walkStartPose(null)).toBeNull();
  });
});

describe("frameDollhouseOnModel", () => {
  const built = { floor: { minX: 0, minZ: 0, maxX: 1000, maxZ: 800 } };
  const rig = () => ({
    camera: new THREE.PerspectiveCamera(50, 1, 1, 24000),
    controls: { target: new THREE.Vector3(), update() {} },
  });

  it("returns false with no floor to frame", () => {
    const { camera, controls } = rig();
    expect(frameDollhouseOnModel(camera, controls, { floor: null })).toBe(false);
  });

  it("targets the floor's center at ground level", () => {
    const { camera, controls } = rig();
    frameDollhouseOnModel(camera, controls, built);
    expect(controls.target.x).toBeCloseTo(500);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(400);
  });

  it("places the camera above the target, within an elevated overview radius", () => {
    const { camera, controls } = rig();
    frameDollhouseOnModel(camera, controls, built);
    expect(camera.position.y).toBeGreaterThan(0);
    const dist = camera.position.distanceTo(controls.target);
    const floorSize = 1000; // max(1000, 800, 240)
    expect(dist).toBeCloseTo(floorSize * 1.3, 0);
  });

  it("starts within the polar-angle range the caller is expected to clamp the controls to", () => {
    const { camera, controls } = rig();
    frameDollhouseOnModel(camera, controls, built);
    const offset = camera.position.clone().sub(controls.target);
    const radius = offset.length();
    const polar = Math.acos(offset.y / radius); // angle from straight up (+Y)
    expect(polar).toBeGreaterThanOrEqual(DOLLHOUSE_POLAR_RANGE.min - 1e-6);
    expect(polar).toBeLessThanOrEqual(DOLLHOUSE_POLAR_RANGE.max + 1e-6);
  });
});

describe("computeFlyStep", () => {
  const zero = { forward: 0, right: 0, up: 0 };
  const noKeys = { forward: false, backward: false, left: false, right: false, up: false, down: false };

  it("accelerates forward when only the forward key is held", () => {
    const step = computeFlyStep(zero, { ...noKeys, forward: true }, 0.1, { speed: 100, damping: 0 });
    expect(step.velocity.forward).toBeCloseTo(10);
    expect(step.forwardDistance).toBeCloseTo(1);
    expect(step.velocity.right).toBe(0);
  });

  it("splits speed between forward and right when moving diagonally", () => {
    const step = computeFlyStep(zero, { ...noKeys, forward: true, right: true }, 0.1, { speed: 100, damping: 0 });
    expect(step.velocity.forward).toBeCloseTo(step.velocity.right);
    // Diagonal input is normalized, not doubled: magnitude should still match `speed`.
    const mag = Math.hypot(step.velocity.forward, step.velocity.right);
    expect(mag).toBeCloseTo(10);
  });

  it("backward and left are negative of forward and right", () => {
    const step = computeFlyStep(zero, { ...noKeys, backward: true, left: true }, 0.1, { speed: 100, damping: 0 });
    expect(step.velocity.forward).toBeLessThan(0);
    expect(step.velocity.right).toBeLessThan(0);
  });

  it("decays existing velocity toward zero when no key is held", () => {
    const moving = { forward: 50, right: 0, up: 0 };
    const step = computeFlyStep(moving, noKeys, 0.1, { damping: 8 });
    expect(step.velocity.forward).toBeLessThan(50);
    expect(step.velocity.forward).toBeGreaterThan(0);
  });

  it("moves up on Space and down on Shift when not vertically locked", () => {
    const up = computeFlyStep(zero, { ...noKeys, up: true }, 0.1, { speed: 100, damping: 0 });
    expect(up.velocity.up).toBeGreaterThan(0);
    const down = computeFlyStep(zero, { ...noKeys, down: true }, 0.1, { speed: 100, damping: 0 });
    expect(down.velocity.up).toBeLessThan(0);
  });

  it("verticalLock (Walk mode) zeroes vertical velocity even if Space/Shift are held", () => {
    const drifting = { forward: 0, right: 0, up: 40 };
    const step = computeFlyStep(drifting, { ...noKeys, up: true }, 0.1, { speed: 100, damping: 0, verticalLock: true });
    expect(step.velocity.up).toBe(0);
    expect(step.upDistance).toBe(0);
  });

  it("tolerates a missing velocity or moveState instead of throwing", () => {
    expect(() => computeFlyStep(undefined, undefined, 0.1)).not.toThrow();
    const step = computeFlyStep(null, null, 0.1);
    expect(step.velocity).toEqual({ forward: 0, right: 0, up: 0 });
  });
});

describe("sprintMultiplier", () => {
  it("is 1x (no sprint) with no Space hold", () => {
    expect(sprintMultiplier(0)).toBe(1);
    expect(sprintMultiplier(-1)).toBe(1);
  });

  it("ramps linearly partway through the ramp window", () => {
    const half = sprintMultiplier(SPRINT_RAMP_SECONDS / 2);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(SPRINT_MAX_MULTIPLIER);
    expect(half).toBeCloseTo(1 + (SPRINT_MAX_MULTIPLIER - 1) / 2);
  });

  it("reaches at least the max multiplier at exactly the ramp window", () => {
    expect(sprintMultiplier(SPRINT_RAMP_SECONDS)).toBeCloseTo(SPRINT_MAX_MULTIPLIER);
  });

  it("caps at the max multiplier — holding longer never exceeds it", () => {
    expect(sprintMultiplier(SPRINT_RAMP_SECONDS * 10)).toBeCloseTo(SPRINT_MAX_MULTIPLIER);
  });
});

describe("resetFirstPersonInputState", () => {
  // Regression for: hold a movement key (Space, mid-sprint) -> pointer lock
  // is lost (Escape, alt-tab, the OS stealing focus) without ever delivering
  // a matching keyup -> the key's "held" state and the sprint ramp would
  // otherwise stay latched -> re-locking resumes movement instantly,
  // potentially already at full sprint speed, with nothing actually pressed.
  it("clears every held movement key, zeroes velocity, and clears the sprint timestamp", () => {
    const moveStateRef = {
      current: { forward: true, backward: false, left: false, right: true, up: true, down: false },
    };
    const flyVelocityRef = { current: { forward: 220, right: 40, up: 96 } };
    const sprintHeldSinceMsRef = { current: 12345 }; // mid-sprint when the lock was lost

    resetFirstPersonInputState(moveStateRef, flyVelocityRef, sprintHeldSinceMsRef);

    expect(moveStateRef.current).toEqual({
      forward: false, backward: false, left: false, right: false, up: false, down: false,
    });
    expect(flyVelocityRef.current).toEqual({ forward: 0, right: 0, up: 0 });
    expect(sprintHeldSinceMsRef.current).toBeNull();
  });

  it("simulates hold -> unlock -> missed keyup -> relock: the next frame after relock starts from a clean, unsprinted stop", () => {
    // "Held" state exactly as it would be mid-sprint, forward key still down.
    const moveStateRef = { current: { forward: true, backward: false, left: false, right: false, up: true, down: false } };
    const flyVelocityRef = { current: { forward: 180, right: 0, up: 60 } };
    const sprintHeldSinceMsRef = { current: 1000 };

    // The keyup that would normally clear this never arrives — pointer lock
    // is simply lost (this is the exact call the component's own
    // onPointerLockChange makes when `locked` becomes false).
    resetFirstPersonInputState(moveStateRef, flyVelocityRef, sprintHeldSinceMsRef);

    // Re-locking (a real relock wouldn't call this again by itself — nothing
    // re-presses the key) and computing what the very next frame would do:
    // no keys held, no sprint in progress.
    const heldForSeconds = sprintHeldSinceMsRef.current != null ? 999 : 0; // would only be non-zero if the timestamp survived
    expect(heldForSeconds).toBe(0);
    expect(sprintMultiplier(heldForSeconds)).toBe(1);
    const step = computeFlyStep(flyVelocityRef.current, moveStateRef.current, 0.1, { speed: 100 });
    expect(step.forwardDistance).toBe(0);
    expect(step.upDistance).toBe(0);
  });
});
