"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  buildThreeScene,
  highlightKeysForSelection,
  highlightRegistryKey,
} from "@/domains/roomDesigner/designerThreeModel";
import { furnitureParts } from "@/domains/roomDesigner/designerFurnitureParts";
import { resolveFurnitureRepresentation } from "@/domains/roomDesigner/furnitureAssetManifest";
import {
  beginDrag3D,
  dragStep3D,
  isClickGesture,
  planPointFromWorld,
  popupAnchorForSelection,
  selectionFromPick,
} from "@/domains/roomDesigner/designer3DEditing";
import Viewport3DSizePopup from "./Viewport3DSizePopup";
import { createFurnitureModelCache, furniturePartGeometry } from "./furnitureModelCache";
import {
  acquireTextureCaches,
  plasterTexture,
  releaseTextureCaches,
  skyTexture,
  woodFloorTexture,
} from "./designerThreeTextures";
import { createTagSpriteCache } from "@/domains/roomDesigner/tagSpriteCache";

const IN = 1; // scene units are inches; camera distances derived from floor size

// Quality tiers (arch review: degrade gracefully on integrated GPUs).
// High: full PBR ambience + 2048 shadows + textures.
// Balanced: PBR ambience + 1024 shadows + textures.
// Low: no environment map + 1024 shadows + flat colors.
const TIERS = {
  high: { env: true, shadowSize: 2048, textured: true },
  balanced: { env: true, shadowSize: 1024, textured: true },
  low: { env: false, shadowSize: 1024, textured: false },
};

function pickQualityTier() {
  try {
    const override = window.localStorage.getItem("forge-3d-quality");
    if (override && TIERS[override]) return override;
  } catch {
    // storage unavailable — fall through to capability detection
  }
  const cores = window.navigator.hardwareConcurrency || 8;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse || cores <= 4) return "low";
  if (cores <= 8) return "balanced";
  return "high";
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const EMPTY_MULTI = Object.freeze([]);

/** Debounce for content rebuilds: rapid drags/keystrokes coalesce into one rebuild. */
const REBUILD_DEBOUNCE_MS = 120;

/** Highlight tint applied to the selected entity's meshes. Cheap: a per-mesh material clone, not a scene rebuild. */
const HIGHLIGHT_COLOR = 0x2dd4bf; // emerald/teal, distinct from the warm interior palette
const HIGHLIGHT_INTENSITY = 0.85;

/**
 * TrueView-style camera framing, extracted so the reset-view button re-runs
 * exactly what the first build does. Pure w.r.t. the design: the same `built`
 * scene descriptor always lands the camera in the same spot. Returns false
 * when there is nothing to frame (so callers can retry on the next build).
 */
export function frameCameraOnModel(camera, controls, built) {
  if (!camera || !controls || !built?.floor) return false;
  const floorSize = Math.max(
    built.floor.maxX - built.floor.minX,
    built.floor.maxZ - built.floor.minZ,
    240,
  );
  const cx = (built.floor.minX + built.floor.maxX) / 2;
  const cz = (built.floor.minZ + built.floor.maxZ) / 2;
  const tallest = Math.max(0, ...(built.equipment || []).map((e) => e.heightIn));
  const frame = Math.max(floorSize, tallest * 1.8);
  camera.position.set(cx + frame * 0.55, frame * 0.75, cz + frame * 0.55);
  camera.far = frame * 20;
  camera.updateProjectionMatrix();
  controls.target.set(cx, Math.min(tallest, floorSize) * 0.3, cz);
  controls.update();
  return true;
}

// ---- Walk / Fly / Dollhouse camera modes ----
//
// Orbit (existing) and Dollhouse both drive the camera through OrbitControls;
// Walk and Fly both drive it through PointerLockControls (mouse-look +
// keyboard movement). Only ONE controls object is ever "live" at a time —
// see the `cameraMode` state in the component below — but both instances
// exist for the life of the viewport so switching modes never re-attaches
// event listeners or reconstructs the camera.

/** Eye height for Walk mode: ~5'6", the standard architectural walkthrough height. */
export const WALK_EYE_HEIGHT_IN = 66;

/** Starting height for Fly mode: high enough to see over most interior walls. */
export const FLY_START_HEIGHT_IN = 96;

/**
 * Starting camera pose for Walk/Fly mode: centered on the model's floor
 * footprint, at a fixed height, offset toward one edge and looking back
 * across the floor — so the user spawns looking INTO the model instead of
 * staring at the nearest wall. Pure (same `built` descriptor frameCameraOnModel
 * uses); returns null when there's no floor to stand on.
 */
export function walkStartPose(built, { heightIn = WALK_EYE_HEIGHT_IN } = {}) {
  if (!built?.floor) return null;
  const cx = (built.floor.minX + built.floor.maxX) / 2;
  const cz = (built.floor.minZ + built.floor.maxZ) / 2;
  const fd = Math.max(built.floor.maxZ - built.floor.minZ, 24);
  return {
    position: { x: cx, y: heightIn, z: cz + fd * 0.3 },
    lookAt: { x: cx, y: heightIn, z: cz - fd * 0.3 },
  };
}

/** Orbit polar-angle range Dollhouse mode is constrained to (radians from straight up). */
export const DOLLHOUSE_POLAR_RANGE = Object.freeze({ min: 0.35, max: 1.15 });

/**
 * Dollhouse camera framing: an elevated 3/4 angle, steeper than Orbit's
 * default, so the room reads as an open-top overview from the first frame.
 * The caller additionally clamps OrbitControls' min/maxPolarAngle to
 * DOLLHOUSE_POLAR_RANGE — that's what actually keeps the user "up top"
 * while still allowing a full spin around the model; this only sets the
 * starting position. Pure math in, camera/controls mutation out — same
 * shape as frameCameraOnModel.
 */
export function frameDollhouseOnModel(camera, controls, built) {
  if (!camera || !controls || !built?.floor) return false;
  const floorSize = Math.max(
    built.floor.maxX - built.floor.minX,
    built.floor.maxZ - built.floor.minZ,
    240,
  );
  const cx = (built.floor.minX + built.floor.maxX) / 2;
  const cz = (built.floor.minZ + built.floor.maxZ) / 2;
  const radius = floorSize * 1.3;
  const polar = (DOLLHOUSE_POLAR_RANGE.min + DOLLHOUSE_POLAR_RANGE.max) / 2;
  const azimuth = Math.PI / 4;
  camera.position.set(
    cx + radius * Math.sin(polar) * Math.sin(azimuth),
    radius * Math.cos(polar),
    cz + radius * Math.sin(polar) * Math.cos(azimuth),
  );
  camera.far = radius * 20;
  camera.updateProjectionMatrix();
  controls.target.set(cx, 0, cz);
  controls.update();
  return true;
}

/** Brisk walking pace, in inches/second (~10 ft/s). */
export const WALK_SPEED_IN_PER_S = 120;
/** Fly mode is faster — covering a whole plant footprint on foot would be tedious. */
export const FLY_SPEED_IN_PER_S = 260;
/** Exponential velocity decay constant (1/s) applied every frame, key held or not. */
export const MOVE_DAMPING = 8;

/**
 * One frame of first-person movement. `velocity` and the return value are
 * plain {forward, right, up} objects in the controls' OWN local frame, not
 * world axes — the caller applies forwardDistance/rightDistance via
 * PointerLockControls.moveForward/moveRight (which already rotate by camera
 * facing) and upDistance as a direct world-Y delta. Pure arithmetic, no
 * THREE dependency, so it's testable without a renderer or a camera.
 *
 * `verticalLock` is Walk mode: up/down input and any residual vertical
 * velocity are zeroed every frame, so gravity-drift never accumulates and
 * releasing Space can never leave the camera settling mid-air.
 */
export function computeFlyStep(velocity, moveState, delta, options = {}) {
  const { speed = WALK_SPEED_IN_PER_S, damping = MOVE_DAMPING, verticalLock = false } = options;
  const decay = Math.max(0, 1 - damping * delta);
  let forwardV = (velocity?.forward || 0) * decay;
  let rightV = (velocity?.right || 0) * decay;
  let upV = verticalLock ? 0 : (velocity?.up || 0) * decay;

  const forwardInput = (moveState?.forward ? 1 : 0) - (moveState?.backward ? 1 : 0);
  const rightInput = (moveState?.right ? 1 : 0) - (moveState?.left ? 1 : 0);
  const upInput = verticalLock ? 0 : (moveState?.up ? 1 : 0) - (moveState?.down ? 1 : 0);
  const planarLen = Math.hypot(forwardInput, rightInput) || 1;

  if (forwardInput) forwardV += (forwardInput / planarLen) * speed * delta;
  if (rightInput) rightV += (rightInput / planarLen) * speed * delta;
  if (upInput) upV += upInput * speed * delta;

  const velocityOut = { forward: forwardV, right: rightV, up: verticalLock ? 0 : upV };
  return {
    velocity: velocityOut,
    forwardDistance: velocityOut.forward * delta,
    rightDistance: velocityOut.right * delta,
    upDistance: velocityOut.up * delta,
  };
}

/** Seconds of continuous Space-hold to reach the sprint speed cap. */
export const SPRINT_RAMP_SECONDS = 3;
/** Sprint multiplier at (and beyond) the ramp cap — "at least 3x" per Jason's request. */
export const SPRINT_MAX_MULTIPLIER = 3;

/**
 * Space-bar sprint in Walk/Fly: holding Space ramps movement speed linearly
 * from 1x up to SPRINT_MAX_MULTIPLIER over SPRINT_RAMP_SECONDS, then holds
 * at the cap for as long as it's held. Releasing Space (tracked by the
 * caller resetting its own held-since timestamp) drops it back to 1x
 * immediately — no decel ramp, so the next sprint always starts from a
 * clean full 3 seconds, not wherever the last one left off.
 */
export function sprintMultiplier(heldForSeconds) {
  if (!(heldForSeconds > 0)) return 1;
  const t = Math.min(heldForSeconds / SPRINT_RAMP_SECONDS, 1);
  return 1 + t * (SPRINT_MAX_MULTIPLIER - 1);
}

// ---- ViewCube gizmo ----
//
// The actual control Jason meant by "the TrueView 360 toggle": a persistent
// compass-and-cube widget (Autodesk's ViewCube, seen in DWG TrueView) fixed
// in the viewport's corner — not a button, not an auto-spinning turntable.
// Drag it to orbit, click a compass letter to snap to a cardinal facing,
// click a cube face for a preset view, click Home to reset. Only meaningful
// alongside OrbitControls, so it's active in Orbit/Dollhouse only — Walk/Fly
// have their own fixed first-person camera and a hidden, pointer-locked
// cursor, neither of which a clickable on-screen widget fits.
//
// v1 scope, disclosed rather than silently dropped: 6 face-click preset
// views (not the full 26 faces/edges/corners a real ViewCube offers), no
// roll arrows, no per-region hover highlight, no screen-reader semantics
// (it's drawn into the WebGL canvas, not a real DOM control).

/** On-screen size (CSS px) of the square the gizmo renders into, and its margin from the viewport's edges. */
export const VIEWCUBE_SIZE_PX = 90;
export const VIEWCUBE_MARGIN_PX = 12;

/** This cube's own render distance from the origin — arbitrary; only its direction (not position) is used against the main camera. */
export const VIEWCUBE_CAMERA_DISTANCE = 4.2;

/** The camera's offset from `target` as {radius, azimuth, polar} — polar measured from +Y, azimuth from +Z toward +X. */
export function sphericalFromCamera(camera, target) {
  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  const radius = Math.hypot(dx, dy, dz) || 1;
  const polar = Math.acos(clamp(dy / radius, -1, 1));
  const azimuth = Math.atan2(dx, dz);
  return { radius, azimuth, polar };
}

/** Places `camera` at the given spherical offset from `target`, looking at it, and re-targets `controls` to match. */
export function applySphericalToCamera(camera, controls, target, { radius, azimuth, polar }) {
  const sinPolar = Math.sin(polar);
  camera.position.set(
    target.x + radius * sinPolar * Math.sin(azimuth),
    target.y + radius * Math.cos(polar),
    target.z + radius * sinPolar * Math.cos(azimuth),
  );
  camera.lookAt(target.x, target.y, target.z);
  if (controls?.target) controls.target.set(target.x, target.y, target.z);
  controls?.update?.();
}

/**
 * The compass ring's four snap directions: azimuth only (radians). These are
 * viewport-relative — around the model's own world-Y axis — not tied to true
 * site/building north, since nothing in this codebase's geometry carries a
 * real-world heading.
 */
export const COMPASS_AZIMUTH = Object.freeze({ N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 });

const MIN_POLAR = 0.05;
const MAX_POLAR = Math.PI - 0.05;

/**
 * The polar-angle band to clamp into: `controls.minPolarAngle`/`maxPolarAngle`
 * when the controls object actually sets them (Dollhouse constrains these to
 * DOLLHOUSE_POLAR_RANGE — see setCameraMode), otherwise the plain MIN_POLAR/
 * MAX_POLAR default. Reading it off `controls` itself, rather than requiring
 * every caller to know which mode is active, keeps this in one place: it's
 * the same clamp OrbitControls.update() would already apply on the next
 * orbit drag, so the gizmo can never push the camera somewhere a normal
 * mouse-drag orbit couldn't also reach.
 */
function polarBounds(controls) {
  const min = Number.isFinite(controls?.minPolarAngle) ? controls.minPolarAngle : MIN_POLAR;
  const max = Number.isFinite(controls?.maxPolarAngle) ? controls.maxPolarAngle : MAX_POLAR;
  return { min, max };
}

/** Snap to a compass direction: same radius and tilt (polar angle) as now, azimuth only changes. */
export function snapToCompassDirection(camera, controls, target, direction) {
  const azimuth = COMPASS_AZIMUTH[direction];
  if (azimuth === undefined) return false;
  const { radius, polar } = sphericalFromCamera(camera, target);
  const { min, max } = polarBounds(controls);
  applySphericalToCamera(camera, controls, target, { radius, azimuth, polar: clamp(polar, min, max) });
  return true;
}

/** Snap to look squarely along a face normal (the ViewCube's face-click preset views), at the current distance from target. */
export function snapToFaceNormal(camera, controls, target, normal) {
  const { radius } = sphericalFromCamera(camera, target);
  const polar = Math.acos(clamp(normal.y, -1, 1));
  const azimuth = Math.atan2(normal.x, normal.z);
  const { min, max } = polarBounds(controls);
  applySphericalToCamera(camera, controls, target, { radius, azimuth, polar: clamp(polar, min, max) });
  return true;
}

/** Radians of orbit per pixel of drag on the gizmo. */
export const GIZMO_DRAG_SENSITIVITY = 0.012;

/** One incremental drag step on the gizmo: orbits the camera by a pixel delta, same math OrbitControls itself uses. */
export function orbitCameraByDrag(camera, controls, target, dxPx, dyPx, sensitivity = GIZMO_DRAG_SENSITIVITY) {
  const { radius, azimuth, polar } = sphericalFromCamera(camera, target);
  const { min, max } = polarBounds(controls);
  applySphericalToCamera(camera, controls, target, {
    radius,
    azimuth: azimuth - dxPx * sensitivity,
    polar: clamp(polar - dyPx * sensitivity, min, max),
  });
}

/**
 * Fresh, fully-released Walk/Fly input state. Used both when leaving
 * Walk/Fly outright (setCameraMode) and — the case this exists to make
 * testable in isolation — when pointer lock is merely LOST while still in
 * Walk/Fly (Escape, alt-tab, the OS stealing focus). None of those reliably
 * deliver a matching keyup for whatever was physically held; without this,
 * re-locking would resume movement instantly, potentially already at full
 * sprint speed, with no key actually pressed. Mutates the three refs'
 * `.current` in place; takes plain `{current}`-shaped objects (not real
 * React refs) so it's testable with no React/DOM involved.
 */
export function resetFirstPersonInputState(moveStateRef, flyVelocityRef, sprintHeldSinceMsRef) {
  moveStateRef.current = { forward: false, backward: false, left: false, right: false, up: false, down: false };
  flyVelocityRef.current = { forward: 0, right: 0, up: 0 };
  sprintHeldSinceMsRef.current = null;
}

/**
 * Floating tag labels (P-101, E-102, …) above equipment so the 3D reads like
 * a plot plan. Canvas textures are cached per unique tag at module scope and
 * shared by every sprite; the cache is reference-counted (see
 * domains/roomDesigner/tagSpriteCache) so eviction and unmount never dispose
 * GPU resources out from under live sprites, and nothing module-scoped
 * outlives the viewport.
 */
function createTagLabelCanvas(text) {
  const font = "600 46px system-ui, -apple-system, sans-serif";
  const measurer = document.createElement("canvas").getContext("2d");
  measurer.font = font;
  const textW = Math.ceil(measurer.measureText(text).width);
  const padX = 26;
  const canvas = document.createElement("canvas");
  canvas.width = textW + padX * 2;
  canvas.height = 84;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  pillPath(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 24);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = "#f1f5f9";
  ctx.textBaseline = "middle";
  ctx.fillText(text, padX, canvas.height / 2 + 2);
  return { canvas, aspect: canvas.width / canvas.height };
}

const tagSpriteCache = createTagSpriteCache({ THREE, createLabelCanvas: createTagLabelCanvas });

export function makeTagSprite(tag) {
  if (typeof document === "undefined") return null;
  const acquired = tagSpriteCache.acquire(tag);
  if (!acquired) return null;
  const sprite = new THREE.Sprite(acquired.material);
  // Marks this sprite as one reference on the shared cache entry; the
  // rebuild disposer consumes it via releaseTagSprite().
  sprite.userData.tagCacheKey = acquired.key;
  const worldW = 120; // inches — readable without dominating the equipment
  sprite.scale.set(worldW, worldW / acquired.aspect, 1);
  sprite.center.set(0.5, 0); // bottom-center anchored, so position.y is the label's base
  return sprite;
}

/** Release one sprite's reference on its shared cache entry (idempotent). */
export function releaseTagSprite(sprite) {
  return tagSpriteCache.release(sprite);
}

/**
 * Dispose every cache entry with no live sprite references. Called on
 * viewport unmount (after the content group's sprites are released) so the
 * module-scoped GPU resources don't leak. Returns the entry count disposed.
 */
export function sweepTagSpriteCache() {
  return tagSpriteCache.sweep();
}

function pillPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Recognizable process-equipment assemblies from the primitive shape
 * descriptors. Towers get dished heads + a support skirt, tall slender
 * shapes read as stacks with a tip band, horizontal vessels get dished ends
 * on saddles, pumps read as skid + casing + motor, spheres keep their legs
 * and gain a top nozzle. Composed from plain Three.js geometry — no model
 * files, no new dependencies. `makeLabel` is injected (canvas sprites need
 * DOM, so tests pass a stub or null).
 */
export function buildEquipmentGroup(eq, { stdMaterial, shadowed, makeLabel = null }) {
  const group = new THREE.Group();
  const mat = stdMaterial({ color: eq.color, roughness: 0.55 });
  const darkMetal = stdMaterial({ color: "#64748b", roughness: 0.7 });
  const w = eq.widthIn;
  const d = eq.depthIn;
  const h = eq.heightIn;

  const addLabel = (labelY) => {
    if (!makeLabel || !eq.tag) return;
    const sprite = makeLabel(eq.tag);
    if (!sprite) return;
    sprite.position.y = labelY;
    // Tag labels are hidden by default -- the viewport's Labels toggle flips
    // them on. userData.isTagLabel lets the component collect them per build.
    sprite.visible = false;
    sprite.userData.isTagLabel = true;
    group.add(sprite);
  };

  if (eq.shape === "vcyl") {
    const r = Math.min(w, d) / 2;
    if (h / (2 * r) > 8) {
      // Stack (flare, vent): tapered shell with a slightly wider tip band.
      const shell = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 24), mat));
      shell.position.y = h / 2;
      group.add(shell);
      const tipH = Math.min(48, h * 0.06);
      const tip = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.02, tipH, 24), darkMetal));
      tip.position.y = h - tipH / 2;
      group.add(tip);
      addLabel(h + 40);
    } else {
      // Tower / column / vertical vessel: skirt + shell + dished heads.
      const skirtH = clamp(h * 0.12, 12, 72);
      const skirt = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.08, skirtH, 24), darkMetal));
      skirt.position.y = skirtH / 2;
      group.add(skirt);
      const shellH = Math.max(1, h - skirtH);
      const shell = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, shellH, 24), mat));
      shell.position.y = skirtH + shellH / 2;
      group.add(shell);
      const topHead = shadowed(
        new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat),
      );
      topHead.scale.y = 0.55; // dished head, not a full dome
      topHead.position.y = skirtH + shellH;
      group.add(topHead);
      addLabel(h + r * 0.55 + 40);
    }
  } else if (eq.shape === "hcyl") {
    // Horizontal vessel: shell + dished ends, riding on two saddles.
    const r = d / 2;
    const shellL = Math.max(1, w - r);
    const saddleH = Math.max(0, h - d);
    const shell = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, shellL, 24), mat));
    shell.rotation.z = Math.PI / 2;
    shell.position.y = saddleH + r;
    group.add(shell);
    const endGeo = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const side of [-1, 1]) {
      const end = shadowed(new THREE.Mesh(endGeo, mat));
      end.scale.y = 0.45; // flatten the dome along its own axis first…
      end.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2; // …then aim it outward
      end.position.set((side * shellL) / 2, saddleH + r, 0);
      group.add(end);
    }
    if (saddleH > 0.5) {
      const saddleW = Math.min(24, w * 0.12);
      for (const side of [-1, 1]) {
        const saddle = shadowed(
          new THREE.Mesh(new THREE.BoxGeometry(saddleW, saddleH, d * 0.7), darkMetal),
        );
        saddle.position.set(side * w * 0.3, saddleH / 2, 0);
        group.add(saddle);
      }
    }
    addLabel(h + r * 0.45 + 40);
  } else if (eq.shape === "box") {
    // Skid-mounted block. Pumps read as casing + motor side by side.
    const skidH = 5;
    const skid = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, skidH, d * 1.06), darkMetal));
    skid.position.y = skidH / 2;
    group.add(skid);
    const bodyH = Math.max(1, h - skidH);
    if (/pump/i.test(eq.symbolId || "")) {
      const casingW = w * 0.45;
      const casing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(casingW, bodyH, d), mat));
      casing.position.set(-w / 2 + casingW / 2, skidH + bodyH / 2, 0);
      group.add(casing);
      const volute = shadowed(
        new THREE.Mesh(new THREE.CylinderGeometry(bodyH * 0.3, bodyH * 0.3, d * 1.2, 20), mat),
      );
      volute.rotation.x = Math.PI / 2;
      volute.position.set(-w / 2 + casingW / 2, skidH + bodyH * 0.45, 0);
      group.add(volute);
      const motorW = w * 0.42;
      const motorH = bodyH * 0.72;
      const motor = shadowed(new THREE.Mesh(new THREE.BoxGeometry(motorW, motorH, d * 0.72), darkMetal));
      motor.position.set(w / 2 - motorW / 2, skidH + motorH / 2, 0);
      group.add(motor);
    } else {
      const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), mat));
      body.position.y = skidH + bodyH / 2;
      group.add(body);
    }
    addLabel(h + 40);
  } else {
    // sphere: pressure sphere on legs, with a top nozzle.
    const r = Math.min(w, d) / 2;
    const legH = Math.max(0, h - 2 * r);
    const ball = shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat));
    ball.position.y = legH + r;
    group.add(ball);
    const legGeo = new THREE.CylinderGeometry(3, 3, Math.max(legH, 0.5), 10);
    for (let i = 0; i < 6 && legH > 0.5; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leg = shadowed(new THREE.Mesh(legGeo, darkMetal));
      leg.position.set(Math.cos(a) * r * 0.7, legH / 2, Math.sin(a) * r * 0.7);
      group.add(leg);
    }
    const nozzle = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.14, r * 0.5, 12), darkMetal));
    nozzle.position.y = legH + 2 * r + r * 0.2;
    group.add(nozzle);
    addLabel(h + r * 0.5 + 40);
  }

  return group;
}

// Selection -> highlight-registry-key mapping now lives in designerThreeModel.js
// (highlightKeysForSelection / highlightRegistryKey) — the pure domain layer,
// unit-tested there against plain design objects with no Three.js involved.

/**
 * 3D view of the design: extruded walls (with real door/window gaps and
 * glass), composed furniture, sun shadows, and PBR ambience.
 *
 * Three independent effects, deliberately not one:
 *   - setup      (mount only)   renderer, camera, controls, lights, resize.
 *                Never re-runs, so orbit position and the WebGL context
 *                survive every design edit and every view-mode switch.
 *   - rebuild    (on `design`)  regenerates just the geometry, debounced so
 *                a rapid 2D drag does not thrash the renderer with a fresh
 *                scene every frame. The camera is centered automatically
 *                ONLY on the first non-empty build; edits after that never
 *                move it out from under the user.
 *   - highlight  (on `selection`) swaps a per-mesh material clone in and
 *                out via a mesh registry built during rebuild. No geometry
 *                is touched and no rebuild happens — selecting is cheap
 *                by construction, not by accident.
 *
 * P1-B editing (only when `dispatch` is passed): click an entity to select
 * it; press-drag an ALREADY-selected wall, opening or furniture piece to
 * move it (anything else still orbits); type new dimensions into the popup
 * pinned above the selection. The gesture math lives in designer3DEditing.js;
 * this component only raycasts and dispatches.
 */
export default function DesignerViewport3D({
  design,
  selection = null,
  multiSelection = EMPTY_MULTI,
  dispatch = null,
  // Called with { x, y } — the plan point under the camera's orbit target
  // (the floor spot the view is centered on) — whenever it moves. One-tap
  // shape placement in 3D drops the shape there.
  onFloorCenterChange = null,
}) {
  const mountRef = useRef(null);

  // Cross-effect handles. Refs, not state: none of this should ever trigger
  // a React re-render — the render loop and Three.js own their own updates.
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const sunRef = useRef(null);
  const contentGroupRef = useRef(null);
  const materialCacheRef = useRef(null);
  // CC0 furniture models: loaded once per viewport; a model arriving (or
  // failing) bumps modelEpoch so the scene rebuilds with it.
  const modelCacheRef = useRef(null);
  const [modelEpoch, setModelEpoch] = useState(0);
  const registryRef = useRef(new Map());
  const highlightedRef = useRef([]); // [{ mesh, originalMaterial }]
  const tierRef = useRef(TIERS.balanced);
  const tierNameRef = useRef("balanced");
  const initialCameraSetRef = useRef(false);
  const rebuildTimerRef = useRef(null);
  const builtRef = useRef(null); // last buildThreeScene descriptor, for reset-view
  // Camera mode: 'orbit' (default, existing behavior) | 'dollhouse' (OrbitControls,
  // constrained to an elevated overview) | 'walk' | 'fly' (PointerLockControls,
  // first-person). Only one controls object is ever active; see the setup
  // effect and setCameraModeAndSync below.
  const [cameraMode, setCameraModeState] = useState("orbit");
  const cameraModeRef = useRef("orbit");
  const pointerLockControlsRef = useRef(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const pointerLockedRef = useRef(false);
  const moveStateRef = useRef({ forward: false, backward: false, left: false, right: false, up: false, down: false });
  const flyVelocityRef = useRef({ forward: 0, right: 0, up: 0 });
  const sprintHeldSinceMsRef = useRef(null); // performance.now() timestamp Space was last pressed, or null while released
  const lastFrameTimeRef = useRef(0);
  // { state, plane, pointerId } while an entity drag (P1-B editing) is in
  // progress; a ref (not a plain closure var) specifically so setCameraMode
  // — defined outside the setup effect — can force-clear a drag that's still
  // active when the user switches into Walk/Fly mid-drag.
  const dragRef = useRef(null);
  // Manual free-roam video capture of the live canvas.
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingStreamRef = useRef(null); // captureStream()'s MediaStream, so its tracks can be stopped explicitly
  const recordingErroredRef = useRef(false); // set by the recorder's own error event; tells a later onstop to skip the download
  // ViewCube gizmo: its own tiny scene/camera, rendered into a scissored
  // corner of the SAME canvas/renderer every frame (no second WebGL
  // context). See the pure helpers above for the math; these refs hold the
  // live Three.js objects and interaction state.
  const gizmoSceneRef = useRef(null);
  const gizmoCameraRef = useRef(null);
  const gizmoHitObjectsRef = useRef([]); // meshes/sprites raycast against, each carrying userData.gizmoAction
  const gizmoDragRef = useRef(null); // { x, y, moved, action } while a gizmo press is down
  const mountSizeRef = useRef({ width: 0, height: 0 }); // CSS-pixel mount size, for placing the gizmo's viewport each frame
  // Equipment tag labels (P-101, E-102, …): hidden by default, flipped by the
  // Labels toggle in the button cluster. Sprites are collected per scene
  // build (they're rebuilt with the scene); the ref mirror avoids rebuilding
  // the whole scene just to flip visibility.
  const [showLabels, setShowLabels] = useState(false);
  const showLabelsRef = useRef(false);
  const selectionRef = useRef(selection);
  const multiSelectionRef = useRef(multiSelection);
  const onFloorCenterChangeRef = useRef(onFloorCenterChange);
  const designRef = useRef(design);
  const dispatchRef = useRef(dispatch);
  const popupRef = useRef(null);
  const popupAnchorRef = useRef(null);
  useEffect(() => {
    selectionRef.current = selection;
    multiSelectionRef.current = multiSelection;
    onFloorCenterChangeRef.current = onFloorCenterChange;
    designRef.current = design;
    dispatchRef.current = dispatch;
    popupAnchorRef.current = popupAnchorForSelection(selection, design);
  }, [selection, multiSelection, design, dispatch, onFloorCenterChange]);
  // ---- setup: once per mount ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    acquireTextureCaches();

    const tierName = pickQualityTier();
    tierNameRef.current = tierName;
    const tier = TIERS[tierName];
    tierRef.current = tier;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;
    mountSizeRef.current = { width, height };

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const threeScene = new THREE.Scene();
    threeScene.background = skyTexture();
    threeScene.fog = new THREE.Fog(0xe9e2d0, 480, 1600);
    sceneRef.current = threeScene;

    let pmrem = null;
    let envRT = null;
    if (tier.env) {
      pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      threeScene.environment = envRT.texture;
      threeScene.environmentIntensity = 0.45;
    }

    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 24000);
    camera.position.set(360, 360, 360);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.update();
    controlsRef.current = controls;

    // Walk/Fly's mouse-look + keyboard movement. Lives alongside OrbitControls
    // for the whole mount; only one of the two is ever driven per frame (see
    // animate() below), selected by cameraModeRef.
    const pointerLockControls = new PointerLockControls(camera, renderer.domElement);
    pointerLockControlsRef.current = pointerLockControls;
    const onPointerLockChange = () => {
      const locked = pointerLockControls.isLocked;
      pointerLockedRef.current = locked;
      setPointerLocked(locked);
      // See resetFirstPersonInputState's own doc comment: losing lock while
      // still in Walk/Fly can't rely on a matching keyup ever arriving for
      // whatever was held.
      if (!locked) resetFirstPersonInputState(moveStateRef, flyVelocityRef, sprintHeldSinceMsRef);
    };
    pointerLockControls.addEventListener("lock", onPointerLockChange);
    pointerLockControls.addEventListener("unlock", onPointerLockChange);

    // WASD + arrows drive Walk/Fly movement; Space/Shift move up/down in Fly.
    // Window-level (not mount-level) so releasing a key never gets "stuck" if
    // focus moved, but a no-op unless a camera mode is actually active AND
    // the user isn't typing into the size popup's inputs.
    const isTypingTarget = (el) => {
      const tag = el?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable;
    };
    const setMoveKey = (code, value) => {
      const move = moveStateRef.current;
      if (code === "KeyW" || code === "ArrowUp") move.forward = value;
      else if (code === "KeyS" || code === "ArrowDown") move.backward = value;
      else if (code === "KeyA" || code === "ArrowLeft") move.left = value;
      else if (code === "KeyD" || code === "ArrowRight") move.right = value;
      else if (code === "Space") {
        move.up = value;
        // Sprint ramp start time: only set on the true false->true edge, not
        // on every auto-repeated keydown the browser fires while a key is
        // held — otherwise the ramp would restart from 0 every ~30ms and
        // never actually reach speed.
        if (value) {
          if (sprintHeldSinceMsRef.current == null) sprintHeldSinceMsRef.current = performance.now();
        } else {
          sprintHeldSinceMsRef.current = null;
        }
      } else if (code === "ShiftLeft" || code === "ShiftRight") move.down = value;
      else return false;
      return true;
    };
    const onKeyDown = (e) => {
      const mode = cameraModeRef.current;
      if ((mode !== "walk" && mode !== "fly") || !pointerLockedRef.current) return;
      if (isTypingTarget(document.activeElement)) return;
      if (setMoveKey(e.code, true)) {
        e.preventDefault();
        // Capture phase + stopPropagation: movement keys must win outright
        // over any other page-level shortcut while Walk/Fly is active and
        // locked — e.g. the 2D plan's own arrow-key selection-nudge handler,
        // which otherwise sits on the same window/keydown and would
        // otherwise get a look at (and could consume) the same event first.
        e.stopPropagation();
      }
    };
    const onKeyUp = (e) => {
      // Always clears moveState (never gated on mode/lock) so a key that was
      // held while switching away from Walk/Fly can't leave it stuck
      // "pressed" if the mode is re-entered later. Only claims the event
      // (stopPropagation) when Walk/Fly is what actually would have consumed
      // it, so an arrow-key release in Orbit/2D never gets swallowed.
      const claimed = setMoveKey(e.code, false);
      const mode = cameraModeRef.current;
      if (claimed && (mode === "walk" || mode === "fly")) e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);

    threeScene.add(new THREE.HemisphereLight(0xbdd5f2, 0x8a7f6a, 0.5));

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(500, 700, 350);
    sun.castShadow = true;
    sun.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 3000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.5;
    threeScene.add(sun);
    threeScene.add(sun.target);
    sunRef.current = sun;

    materialCacheRef.current = new Map();
    modelCacheRef.current = createFurnitureModelCache({ onChange: () => setModelEpoch((n) => n + 1) });

    // ---- ViewCube gizmo: its own tiny scene, rendered into a scissored
    // corner of this SAME renderer every frame (see animate() below) ----
    const gizmoScene = new THREE.Scene();
    gizmoScene.background = new THREE.Color(0x0f172a); // slate-900, matches the button cluster's dark chrome
    const gizmoHitObjects = [];

    const makeGizmoLabelSprite = (text) => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(30, 41, 59, 0.95)"; // slate-800
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0"; // slate-200
      ctx.font = "600 30px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, size / 2, size / 2 + 1);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
    };

    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const cubeMaterial = new THREE.MeshBasicMaterial({ color: 0x334155 }); // slate-700
    const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
    // Which face was hit is resolved from the raycast's own face normal at
    // click time (buildGizmoActionFromHit below) — one mesh, six faces,
    // rather than six separately-tagged meshes.
    cubeMesh.userData.gizmoAction = { type: "cube" };
    gizmoScene.add(cubeMesh);
    gizmoHitObjects.push(cubeMesh);

    const cubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cubeGeometry),
      new THREE.LineBasicMaterial({ color: 0x94a3b8 }), // slate-400
    );
    gizmoScene.add(cubeEdges);

    // Compass ring: fixed in the gizmo's own world space (NOT screen space),
    // same as a real ViewCube — as the gizmo camera orbits to track the main
    // camera's facing, different letters rotate into view, exactly like
    // standing in the model and watching which compass direction faces you.
    const COMPASS_RING_RADIUS = 1.55;
    for (const [direction, azimuth] of Object.entries(COMPASS_AZIMUTH)) {
      const sprite = makeGizmoLabelSprite(direction);
      sprite.scale.set(0.5, 0.5, 1);
      sprite.position.set(Math.sin(azimuth) * COMPASS_RING_RADIUS, 0, Math.cos(azimuth) * COMPASS_RING_RADIUS);
      sprite.userData.gizmoAction = { type: "compass", direction };
      gizmoScene.add(sprite);
      gizmoHitObjects.push(sprite);
    }

    gizmoScene.add(new THREE.AmbientLight(0xffffff, 1));

    gizmoSceneRef.current = gizmoScene;
    gizmoHitObjectsRef.current = gizmoHitObjects;

    const gizmoCamera = new THREE.OrthographicCamera(-1.9, 1.9, 1.9, -1.9, 0.1, 20);
    gizmoCameraRef.current = gizmoCamera;

    const gizmoRaycaster = new THREE.Raycaster();
    const gizmoNdc = new THREE.Vector2();

    /** Screen-space (canvas-relative CSS px) box the gizmo currently renders into, or null before the first resize. */
    const gizmoScreenRect = () => {
      const w = mountSizeRef.current.width;
      const h = mountSizeRef.current.height;
      if (!(w > 0) || !(h > 0)) return null;
      return { left: w - VIEWCUBE_SIZE_PX - VIEWCUBE_MARGIN_PX, top: VIEWCUBE_MARGIN_PX, size: VIEWCUBE_SIZE_PX };
    };

    /**
     * Resolves a pointer event to a gizmo action, or null if the event
     * didn't land inside the gizmo's on-screen box at all (the caller should
     * then fall through to normal entity-pick/orbit handling). A hit inside
     * the box with nothing under the cursor (its dark background) resolves
     * to `{ action: null }` — truthy, so the caller still claims the event
     * instead of letting it orbit the model behind the widget, but there's
     * nothing to actually do on release.
     */
    const hitTestGizmo = (e) => {
      if (cameraModeRef.current !== "orbit" && cameraModeRef.current !== "dollhouse") return null;
      const rect = gizmoScreenRect();
      if (!rect) return null;
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const px = e.clientX - canvasRect.left;
      const py = e.clientY - canvasRect.top;
      if (px < rect.left || px > rect.left + rect.size || py < rect.top || py > rect.top + rect.size) return null;
      gizmoNdc.set(((px - rect.left) / rect.size) * 2 - 1, -((py - rect.top) / rect.size) * 2 + 1);
      gizmoRaycaster.setFromCamera(gizmoNdc, gizmoCamera);
      const hits = gizmoRaycaster.intersectObjects(gizmoHitObjectsRef.current, false);
      if (hits.length === 0) return { action: null };
      const hit = hits[0];
      const tag = hit.object.userData.gizmoAction;
      if (tag?.type === "cube") {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
        return { action: { type: "face", normal } };
      }
      return { action: tag ?? null };
    };

    /** Applies a resolved gizmo action (a clean click, not a drag) to the main camera. */
    const applyGizmoAction = (action) => {
      if (!action) return;
      const target = controls.target;
      if (action.type === "compass") snapToCompassDirection(camera, controls, target, action.direction);
      else if (action.type === "face") snapToFaceNormal(camera, controls, target, action.normal);
    };

    // Pin the size popup above the selection: project its world anchor to
    // pane pixels every frame and move the element directly — orbiting must
    // not re-render React.
    const anchorVec = new THREE.Vector3();
    const placePopup = () => {
      const el = popupRef.current;
      if (!el) return;
      const anchor = popupAnchorRef.current;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!anchor || !(w > 0) || !(h > 0)) {
        el.style.visibility = "hidden";
        return;
      }
      anchorVec.set(anchor.x, anchor.y, anchor.z).project(camera);
      const onScreen = anchorVec.z < 1 && Math.abs(anchorVec.x) <= 1 && Math.abs(anchorVec.y) <= 1;
      el.style.visibility = onScreen ? "visible" : "hidden";
      const px = ((anchorVec.x + 1) / 2) * w;
      const py = ((1 - anchorVec.y) / 2) * h;
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
    };

    const lastTarget = { x: NaN, z: NaN };
    lastFrameTimeRef.current = performance.now();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      // Clamp delta: a backgrounded tab (or a debugger pause) resuming after
      // seconds away must not fling the camera through the model in one step.
      const delta = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = now;

      const mode = cameraModeRef.current;
      if (mode === "walk" || mode === "fly") {
        if (pointerLockedRef.current) {
          // Space-bar sprint: ramps 1x -> SPRINT_MAX_MULTIPLIER over
          // SPRINT_RAMP_SECONDS of continuous hold, in both Walk and Fly —
          // Space's other role (ascend in Fly; a no-op in Walk, which zeroes
          // vertical velocity outright) is unaffected, so holding Space in
          // Fly both lifts you and sprints your horizontal motion.
          const heldForSeconds = sprintHeldSinceMsRef.current != null
            ? (now - sprintHeldSinceMsRef.current) / 1000
            : 0;
          const speedMultiplier = sprintMultiplier(heldForSeconds);
          const step = computeFlyStep(flyVelocityRef.current, moveStateRef.current, delta, {
            speed: (mode === "fly" ? FLY_SPEED_IN_PER_S : WALK_SPEED_IN_PER_S) * speedMultiplier,
            verticalLock: mode === "walk",
          });
          flyVelocityRef.current = step.velocity;
          pointerLockControls.moveForward(step.forwardDistance);
          pointerLockControls.moveRight(step.rightDistance);
          if (mode === "walk") camera.position.y = WALK_EYE_HEIGHT_IN;
          else camera.position.y += step.upDistance;
        }
      } else {
        controls.update();
      }
      renderer.render(threeScene, camera);
      // ViewCube gizmo, Orbit/Dollhouse only — Walk/Fly have no on-screen
      // widget to click while the pointer is locked. Scissored into a corner
      // of the SAME renderer/canvas rather than a second WebGL context; the
      // gizmo camera mirrors the main camera's VIEWING DIRECTION (not its
      // position) from a fixed distance, so the cube shows current facing.
      const { width: mw, height: mh } = mountSizeRef.current;
      if ((mode === "orbit" || mode === "dollhouse") && mw > 0 && mh > 0) {
        const gizmoCamera = gizmoCameraRef.current;
        const gizmoScene = gizmoSceneRef.current;
        if (gizmoCamera && gizmoScene) {
          const dir = camera.position.clone().sub(controls.target).normalize();
          gizmoCamera.position.copy(dir.multiplyScalar(VIEWCUBE_CAMERA_DISTANCE));
          gizmoCamera.up.copy(camera.up);
          gizmoCamera.lookAt(0, 0, 0);
          const vx = mw - VIEWCUBE_SIZE_PX - VIEWCUBE_MARGIN_PX;
          const vy = mh - VIEWCUBE_SIZE_PX - VIEWCUBE_MARGIN_PX; // Three.js viewport/scissor Y is measured from the BOTTOM
          renderer.setScissorTest(true);
          renderer.setScissor(vx, vy, VIEWCUBE_SIZE_PX, VIEWCUBE_SIZE_PX);
          renderer.setViewport(vx, vy, VIEWCUBE_SIZE_PX, VIEWCUBE_SIZE_PX);
          renderer.render(gizmoScene, gizmoCamera); // autoClear wipes color+depth within the scissor rect only
          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, mw, mh);
        }
      }
      placePopup();
      // Report the orbit target only when it actually moves (not every frame).
      const t = controls.target;
      if (onFloorCenterChangeRef.current && (t.x !== lastTarget.x || t.z !== lastTarget.z)) {
        lastTarget.x = t.x;
        lastTarget.z = t.z;
        onFloorCenterChangeRef.current({ x: t.x, y: t.z });
      }
    };
    animate();

    // ---- P1-B: pick / drag from the 3D view ----
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const planeHit = new THREE.Vector3();
    const castFrom = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return false;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld(); // see pickAt: never trust last frame's matrices
      raycaster.setFromCamera(ndc, camera);
      return true;
    };
    /** Nearest hit in the content group, with the entity tag of its tagged ancestor (or null). */
    const pickAt = (e) => {
      const group = contentGroupRef.current;
      if (!group || !castFrom(e)) return null;
      // Rebuilds (and the first-build camera placement) land in a timeout,
      // not a frame: a click before the next render would otherwise raycast
      // against stale world matrices and miss everything.
      group.updateMatrixWorld();
      const [hit] = raycaster.intersectObject(group, true);
      if (!hit) return null;
      let obj = hit.object;
      while (obj && obj !== group && !obj.userData?.entityKind) obj = obj.parent;
      const tag = obj && obj !== group ? obj.userData : null;
      return { tag, point: hit.point };
    };
    const sameEntity = (p, q) => !!p && !!q && p.kind === q.kind && p.id === q.id;

    let pressAt = null; // { x, y } of the primary-button press, for click detection

    // Capture phase on the mount element: runs before OrbitControls' own
    // listener on the canvas, so an entity drag can claim the gesture
    // (stopPropagation) before the camera starts orbiting.
    const onPointerDown = (e) => {
      // Walk/Fly are navigation-only: no entity picking or dragging while
      // first-person controls are active. A click either requests pointer
      // lock (mouse-look starts) or, if already locked, does nothing — the
      // pointer is hidden and pinned to the pane center, so a "click" no
      // longer corresponds to a screen position a raycast should trust.
      if (cameraModeRef.current === "walk" || cameraModeRef.current === "fly") {
        if (!pointerLockedRef.current && e.button === 0) pointerLockControls.lock();
        return;
      }
      // ViewCube gizmo claims any press inside its on-screen box before
      // entity-pick/orbit ever sees it — including a miss on its background,
      // so a click meant for the widget can never fall through and orbit the
      // model underneath it.
      if (e.button === 0) {
        const gizmoHit = hitTestGizmo(e);
        if (gizmoHit) {
          gizmoDragRef.current = { x: e.clientX, y: e.clientY, moved: false, action: gizmoHit.action };
          controls.enabled = false;
          try {
            mount.setPointerCapture(e.pointerId);
          } catch {
            // capture is a nicety; never fatal
          }
          e.stopPropagation();
          return;
        }
      }
      if (e.button !== 0 || !dispatchRef.current) return;
      pressAt = { x: e.clientX, y: e.clientY };
      const picked = pickAt(e);
      const target = selectionFromPick(picked?.tag);
      if (!sameEntity(target, selectionRef.current)) return; // not the selection: let it orbit
      const state = beginDrag3D(target, designRef.current, planPointFromWorld(picked.point));
      if (!state) return;
      // Drag on the horizontal plane at the grab height, so the entity
      // tracks the cursor exactly instead of the floor point far behind it.
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -picked.point.y);
      dragRef.current = { state, plane, pointerId: e.pointerId };
      controls.enabled = false;
      try {
        mount.setPointerCapture(e.pointerId);
      } catch {
        // capture is a nicety (drag continues outside the pane); never fatal
      }
      e.stopPropagation();
    };
    const onPointerMove = (e) => {
      if (cameraModeRef.current === "walk" || cameraModeRef.current === "fly") return;
      if (gizmoDragRef.current) {
        const gd = gizmoDragRef.current;
        const dx = e.clientX - gd.x;
        const dy = e.clientY - gd.y;
        // A small dead zone before a press counts as a drag rather than a
        // click — a real click always jitters a pixel or two.
        if (!gd.moved && Math.hypot(dx, dy) > 3) gd.moved = true;
        if (gd.moved) {
          orbitCameraByDrag(camera, controls, controls.target, dx, dy);
          gd.x = e.clientX;
          gd.y = e.clientY;
        }
        return;
      }
      if (dragRef.current) {
        if (!castFrom(e) || !raycaster.ray.intersectPlane(dragRef.current.plane, planeHit)) return;
        const step = dragStep3D(dragRef.current.state, designRef.current, planPointFromWorld(planeHit));
        dragRef.current.state = step.drag;
        if (step.action) dispatchRef.current?.(step.action);
        return;
      }
      if (e.buttons !== 0 || !dispatchRef.current) return;
      // Hover affordance: "move" over the draggable selection, "pointer"
      // over anything selectable, default (orbit) elsewhere.
      const target = selectionFromPick(pickAt(e)?.tag);
      mount.style.cursor = !target ? "" : sameEntity(target, selectionRef.current) ? "move" : "pointer";
    };
    const endEntityDrag = (e) => {
      if (!dragRef.current) return false;
      try {
        mount.releasePointerCapture(dragRef.current.pointerId);
      } catch {
        // already released (or never captured); nothing to undo
      }
      dragRef.current = null;
      controls.enabled = true;
      e.stopPropagation();
      return true;
    };
    const onPointerUp = (e) => {
      if (cameraModeRef.current === "walk" || cameraModeRef.current === "fly") return;
      if (gizmoDragRef.current) {
        const gd = gizmoDragRef.current;
        gizmoDragRef.current = null;
        try {
          mount.releasePointerCapture(e.pointerId);
        } catch {
          // already released (or never captured); nothing to undo
        }
        controls.enabled = true;
        if (!gd.moved) applyGizmoAction(gd.action);
        e.stopPropagation();
        return;
      }
      const press = pressAt;
      pressAt = null;
      if (endEntityDrag(e)) return;
      if (e.button !== 0 || !dispatchRef.current) return;
      if (!isClickGesture(press, { x: e.clientX, y: e.clientY })) return; // it was an orbit
      const target = selectionFromPick(pickAt(e)?.tag);
      if (target) {
        if (!sameEntity(target, selectionRef.current)) dispatchRef.current({ type: "SELECT", selection: target });
      } else if (selectionRef.current) {
        dispatchRef.current({ type: "CLEAR_SELECTION" });
      }
    };
    const onPointerCancel = (e) => {
      pressAt = null;
      if (gizmoDragRef.current) {
        gizmoDragRef.current = null;
        controls.enabled = true;
      }
      endEntityDrag(e);
    };
    mount.addEventListener("pointerdown", onPointerDown, true);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup", onPointerUp, true);
    mount.addEventListener("pointercancel", onPointerCancel, true);

    // A ResizeObserver, not a window resize listener: toggling this pane's
    // CSS visibility (2D-only <-> split <-> 3D-only) and dragging the split
    // divider both change this element's size without the window itself
    // resizing, and a window-only listener would miss both.
    const applySize = (w, h) => {
      if (!(w > 0) || !(h > 0)) return; // a hidden (display:none) pane reports 0x0 — skip, don't corrupt the camera
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      mountSizeRef.current = { width: w, height: h };
    };
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      applySize(w, h);
    });
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      mount.removeEventListener("pointerdown", onPointerDown, true);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", onPointerUp, true);
      mount.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      pointerLockControls.removeEventListener("lock", onPointerLockChange);
      pointerLockControls.removeEventListener("unlock", onPointerLockChange);
      if (pointerLockControls.isLocked) pointerLockControls.unlock();
      pointerLockControls.dispose();
      pointerLockControlsRef.current = null;
      // recorder.stop() (below) triggers the same onstop handler that stops
      // the stream's tracks — but if the recorder never actually reached a
      // running state (construction/start failed after captureStream already
      // handed back a live stream), onstop never fires, so the tracks are
      // also stopped directly here as a fallback.
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      } else if (recordingStreamRef.current) {
        for (const track of recordingStreamRef.current.getTracks()) track.stop();
        recordingStreamRef.current = null;
      }
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
      controls.dispose();
      // ViewCube gizmo: dispose the cube's geometry/material, its edge lines,
      // and every compass sprite's canvas texture + material — nothing here
      // is shared with the material cache above, so it's all this scene's own.
      gizmoScene.traverse((obj) => {
        if (obj.isSprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        } else if (obj.isLineSegments || obj.isMesh) {
          obj.geometry?.dispose();
          obj.material?.dispose();
        }
      });
      gizmoSceneRef.current = null;
      gizmoCameraRef.current = null;
      gizmoHitObjectsRef.current = [];
      gizmoDragRef.current = null;
      contentGroupRef.current = swapContentGroup(threeScene, contentGroupRef.current, null);
      // The swap released every tag sprite's cache reference; reap the now-
      // unreferenced entries so module-scoped GPU resources don't outlive the
      // viewport.
      sweepTagSpriteCache();
      for (const m of materialCacheRef.current.values()) m.dispose();
      materialCacheRef.current.clear();
      modelCacheRef.current?.dispose();
      modelCacheRef.current = null;
      for (const { originalMaterial } of highlightedRef.current) {
        // The clone that stood in for the original is on the (now-disposed)
        // mesh; nothing further to release here besides the bookkeeping.
        void originalMaterial;
      }
      highlightedRef.current = [];
      registryRef.current = new Map();
      initialCameraSetRef.current = false;
      envRT?.dispose();
      pmrem?.dispose();
      releaseTextureCaches();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sunRef.current = null;
    };
    // Intentionally empty deps: this effect must run exactly once per mount.
  }, []);

  // ---- rebuild: on design change, debounced ----
  useEffect(() => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null;
      const scene = sceneRef.current;
      const materialCache = materialCacheRef.current;
      if (!scene || !materialCache) return; // setup effect has not run yet (or has torn down)

      let built;
      try {
        built = buildThreeScene(design);
      } catch {
        // A transiently invalid design (mid-edit) must not blank the 3D
        // view or throw out of an effect; keep showing the last good build.
        return;
      }

      const group = new THREE.Group();
      const registry = new Map();
      const register = (key, mesh) => {
        const list = registry.get(key);
        if (list) list.push(mesh);
        else registry.set(key, [mesh]);
      };

      const stdMaterial = ({ color, map = null, roughness = 0.85, transparent = false, opacity = 1, depthWrite = true }) => {
        const key = `${color}|${roughness}|${transparent}|${map ? "map" : ""}`;
        if (!materialCache.has(key)) {
          materialCache.set(
            key,
            new THREE.MeshStandardMaterial({
              color,
              map,
              roughness,
              metalness: 0,
              ...(transparent ? { transparent: true, opacity, depthWrite } : {}),
            }),
          );
        }
        return materialCache.get(key);
      };
      const shadowed = (mesh) => {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
      };

      const tier = tierRef.current;
      const tierName = tierNameRef.current;

      // floor
      if (built.floor) {
        const fw = built.floor.maxX - built.floor.minX;
        const fd = built.floor.maxZ - built.floor.minZ;
        const floorMat = tier.textured
          ? stdMaterial({ color: "#ffffff", map: woodFloorTexture(fw / 96, fd / 96), roughness: 0.7 })
          : stdMaterial({ color: "#a98f66", roughness: 0.9 });
        const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(
          (built.floor.minX + built.floor.maxX) / 2,
          -0.5,
          (built.floor.minZ + built.floor.maxZ) / 2,
        );
        floorMesh.receiveShadow = true;
        group.add(floorMesh);
      }

      // walls (+ window sills/headers)
      const wallMaterial = tier.textured
        ? stdMaterial({ color: "#ffffff", map: plasterTexture(3, 1.5), roughness: 0.95 })
        : stdMaterial({ color: "#ece8dc", roughness: 0.95 });
      const trimMaterial = stdMaterial({ color: "#d9d2c2", roughness: 0.9 });
      const glassMaterial = stdMaterial({
        color: "#bcd6e8", roughness: 0.1, transparent: true, opacity: 0.22, depthWrite: false,
      });
      for (const seg of built.walls) {
        const length = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
        if (length < 0.5) continue;
        const height = seg.y1In - seg.y0In;
        if (height < 0.5) continue;
        const mesh = shadowed(
          new THREE.Mesh(
            new THREE.BoxGeometry(length, height, seg.thicknessIn * IN),
            seg.kind === "wall" ? wallMaterial : trimMaterial,
          ),
        );
        const angle = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
        mesh.position.set((seg.a.x + seg.b.x) / 2, seg.y0In + height / 2, (seg.a.y + seg.b.y) / 2);
        mesh.rotation.y = -angle;
        group.add(mesh);
        // A window's sill/header belongs to the opening, not the wall: a
        // click on it should select (and a drag slide) the window.
        mesh.userData.entityKind = seg.openingId ? "opening" : "wall";
        mesh.userData.entityId = seg.openingId || seg.wallId;
        register(highlightRegistryKey("wall", seg.wallId), mesh);
        if (seg.openingId) register(highlightRegistryKey("opening", seg.openingId), mesh);
      }

      // window glass
      for (const pane of built.glass || []) {
        const length = Math.hypot(pane.b.x - pane.a.x, pane.b.y - pane.a.y);
        if (length < 0.5) continue;
        const height = pane.y1In - pane.y0In;
        if (height < 0.5) continue;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, height), glassMaterial);
        const angle = Math.atan2(pane.b.y - pane.a.y, pane.b.x - pane.a.x);
        mesh.position.set((pane.a.x + pane.b.x) / 2, pane.y0In + height / 2, (pane.a.y + pane.b.y) / 2);
        mesh.rotation.y = -angle;
        group.add(mesh);
        mesh.userData.entityKind = "opening";
        mesh.userData.entityId = pane.openingId;
        if (pane.openingId) register(highlightRegistryKey("opening", pane.openingId), mesh);
      }

      // furniture: a vendored CC0 model when one fits the piece's footprint
      // and has loaded, otherwise composed groups from pure part descriptors
      for (const item of built.furniture) {
        const fGroup = new THREE.Group();
        const rep = resolveFurnitureRepresentation(item.catalogId, item);
        const model = rep.kind === "model" ? modelCacheRef.current?.instantiate(rep.asset, rep.fit) : null;
        if (model) {
          fGroup.add(model);
        } else {
          const parts = furnitureParts(item.catalogId || "unknown", {
            widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, color: item.color,
          });
          for (const part of parts) {
            const mat = stdMaterial({ color: part.color || item.color, roughness: 0.8 });
            const mesh = shadowed(new THREE.Mesh(furniturePartGeometry(part), mat));
            mesh.position.set(part.dx, part.dy, part.dz);
            if (part.rotX) mesh.rotation.x = part.rotX;
            fGroup.add(mesh);
          }
        }
        fGroup.position.set(item.x, item.elevationIn || 0, item.z);
        fGroup.rotation.y = item.rotY;
        group.add(fGroup);
        fGroup.userData.entityKind = "furniture";
        fGroup.userData.entityId = item.id;
        register(highlightRegistryKey("furniture", item.id), fGroup);
      }

      // process equipment: composed assemblies (heads, skirts, saddles,
      // skids, tag labels) — selectable like furniture.
      for (const eq of built.equipment || []) {
        const eGroup = buildEquipmentGroup(eq, { stdMaterial, shadowed, makeLabel: makeTagSprite });
        eGroup.position.set(eq.x, 0, eq.z);
        eGroup.rotation.y = eq.rotY;
        eGroup.userData.entityKind = "symbol";
        eGroup.userData.entityId = eq.id;
        group.add(eGroup);
        register(highlightRegistryKey("symbol", eq.id), eGroup);
      }
      // Labels are hidden by default; re-apply the toggle state after every
      // rebuild (new sprites are born hidden).
      group.traverse((o) => { if (o.isSprite && o.userData.isTagLabel) o.visible = showLabelsRef.current; });

      // stairs: composed runs + landings from pure descriptors, with railings.
      const stairWood = stdMaterial({ color: "#8f6f4b", roughness: 0.75 });
      const stairRailMat = stdMaterial({ color: "#6b5138", roughness: 0.7 });
      const RAIL_HEIGHT_IN = 36;
      const balusterEveryIn = tierName === "high" ? 8 : tierName === "balanced" ? 12 : 18;
      const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
      const beamBetween = (g, p1, p2, thickness, mat) => {
        const dir = v3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        const len = dir.length();
        if (len < 1) return;
        const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, len), mat));
        mesh.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
        mesh.quaternion.setFromUnitVectors(v3(0, 0, 1), dir.normalize());
        g.add(mesh);
      };
      const postAt = (g, x, yBase, z, height, mat) => {
        const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, height, 2), mat));
        mesh.position.set(x, yBase + height / 2, z);
        g.add(mesh);
      };
      const runFrame = (part) => {
        const alongX = part.dir === "positive-x" || part.dir === "negative-x";
        const ax = part.x0;
        const az = part.z0;
        const bx = alongX ? part.x0 + part.dx : part.x0;
        const bz = alongX ? part.z0 : part.z0 + part.dz;
        return {
          ax, az, bx, bz,
          width: Math.abs(alongX ? part.dz : part.dx),
          px: alongX ? 0 : 1, pz: alongX ? 1 : 0,
          y0: part.y0, rise: part.riseIn, steps: part.steps, treadIn: part.treadIn, riserIn: part.riserIn,
        };
      };
      const runRect = (f) => {
        const xs = [f.ax, f.bx, f.ax + f.px * f.width, f.bx + f.px * f.width];
        const zs = [f.az, f.bz, f.az + f.pz * f.width, f.bz + f.pz * f.width];
        return { x1: Math.min(...xs), x2: Math.max(...xs), z1: Math.min(...zs), z2: Math.max(...zs) };
      };
      for (const stair of built.stairs || []) {
        const sGroup = new THREE.Group();
        const yBase = stair.baseElevationIn || 0;
        const runRects = (stair.parts || []).filter((p) => p.kind === "run").map((p) => runRect(runFrame(p)));
        for (const part of stair.parts || []) {
          if (part.kind === "run") {
            const f = runFrame(part);
            const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
            if (len < 1 || f.steps < 1) continue;
            const at = (s, perpOff, y) => ({
              x: f.ax + ((f.bx - f.ax) * s) / len + f.px * perpOff,
              z: f.az + ((f.bz - f.az) * s) / len + f.pz * perpOff,
              y,
            });
            const alongX = Math.abs(f.bx - f.ax) >= Math.abs(f.bz - f.az);
            for (let i = 0; i < f.steps; i += 1) {
              const h = (i + 1) * f.riserIn;
              const c = at((i + 0.5) * f.treadIn, f.width / 2, yBase + f.y0 + h / 2);
              const mesh = shadowed(
                new THREE.Mesh(
                  new THREE.BoxGeometry(alongX ? f.treadIn : f.width, h, alongX ? f.width : f.treadIn),
                  stairWood,
                ),
              );
              mesh.position.set(c.x, c.y, c.z);
              sGroup.add(mesh);
            }
            for (const edgeOff of [0, f.width]) {
              const p1 = at(0, edgeOff, yBase + f.y0 + RAIL_HEIGHT_IN);
              const p2 = at(len, edgeOff, yBase + f.y0 + f.rise + RAIL_HEIGHT_IN);
              beamBetween(sGroup, p1, p2, 3, stairRailMat);
              for (let s = 0; s <= len + 0.01; s += balusterEveryIn) {
                const b = at(Math.min(s, len), edgeOff, 0);
                postAt(sGroup, b.x, yBase + f.y0 + (Math.min(s, len) / len) * f.rise, b.z, RAIL_HEIGHT_IN, stairRailMat);
              }
            }
          } else if (part.kind === "landing") {
            const lx1 = Math.min(part.x0, part.x0 + part.dx);
            const lx2 = Math.max(part.x0, part.x0 + part.dx);
            const lz1 = Math.min(part.z0, part.z0 + part.dz);
            const lz2 = Math.max(part.z0, part.z0 + part.dz);
            const mesh = shadowed(
              new THREE.Mesh(new THREE.BoxGeometry(lx2 - lx1, part.thicknessIn, lz2 - lz1), stairWood),
            );
            mesh.position.set((lx1 + lx2) / 2, yBase + part.y0 - part.thicknessIn / 2, (lz1 + lz2) / 2);
            sGroup.add(mesh);
            const edges = [
              [{ x: lx1, z: lz1 }, { x: lx2, z: lz1 }],
              [{ x: lx2, z: lz1 }, { x: lx2, z: lz2 }],
              [{ x: lx2, z: lz2 }, { x: lx1, z: lz2 }],
              [{ x: lx1, z: lz2 }, { x: lx1, z: lz1 }],
            ];
            for (const [e1, e2] of edges) {
              const mx = (e1.x + e2.x) / 2;
              const mz = (e1.z + e2.z) / 2;
              const touchesRun = runRects.some(
                (r) => mx > r.x1 - 1 && mx < r.x2 + 1 && mz > r.z1 - 1 && mz < r.z2 + 1,
              );
              if (touchesRun) continue;
              const q1 = { x: e1.x, y: yBase + part.y0 + RAIL_HEIGHT_IN, z: e1.z };
              const q2 = { x: e2.x, y: yBase + part.y0 + RAIL_HEIGHT_IN, z: e2.z };
              beamBetween(sGroup, q1, q2, 3, stairRailMat);
              const edgeLen = Math.hypot(e2.x - e1.x, e2.z - e1.z);
              for (let s = 0; s <= edgeLen + 0.01; s += balusterEveryIn) {
                const t = edgeLen < 0.01 ? 0 : s / edgeLen;
                postAt(sGroup, e1.x + (e2.x - e1.x) * t, yBase + part.y0, e1.z + (e2.z - e1.z) * t, RAIL_HEIGHT_IN, stairRailMat);
              }
            }
          }
        }
        sGroup.position.set(stair.x, yBase, stair.z);
        sGroup.rotation.y = stair.rotY;
        group.add(sGroup);
      }

      contentGroupRef.current = swapContentGroup(scene, contentGroupRef.current, group);
      registryRef.current = registry;

      // Fog and shadow frustum track the model's footprint; the camera does
      // not — only the very first build centers it.
      const floorSize = built.floor
        ? Math.max(built.floor.maxX - built.floor.minX, built.floor.maxZ - built.floor.minZ, 240)
        : 480;
      if (scene.fog) {
        scene.fog.near = floorSize * 1.5;
        scene.fog.far = floorSize * 5;
      }
      const sun = sunRef.current;
      if (sun) {
        const cx = built.floor ? (built.floor.minX + built.floor.maxX) / 2 : 0;
        const cz = built.floor ? (built.floor.minZ + built.floor.maxZ) / 2 : 0;
        const ext = built.floor ? clamp(Math.max(floorSize, 240) / 2, 120, 1200) : 480;
        sun.position.set(cx + ext * 1.1, ext * 1.5, cz + ext * 0.7);
        sun.target.position.set(cx, 0, cz);
        sun.shadow.camera.left = -ext;
        sun.shadow.camera.right = ext;
        sun.shadow.camera.top = ext;
        sun.shadow.camera.bottom = -ext;
        sun.shadow.camera.far = ext * 4 + 500;
        sun.shadow.camera.updateProjectionMatrix();
      }

      const camera = cameraRef.current;
      const controls = controlsRef.current;
      // "First build" means the first one with something in it: a design
      // that starts empty (the placeholder shown before "Recover unsaved
      // work", or a fresh design before its first wall) must not use up the
      // one-time framing on nothing and leave the real house off-screen.
      // The camera is centered automatically ONLY on the first non-empty
      // build; edits after that never move it out from under the user. The
      // reset-view button re-runs this same framing on demand.
      //
      // Which framing depends on whatever camera mode is CURRENT at the
      // moment the first build lands — not always Orbit's. A user can pick
      // Walk before the model finishes its first build (a fresh/empty design,
      // or a slow initial load); without this branch, this one-time framing
      // would always call frameCameraOnModel and silently teleport them back
      // to the elevated Orbit view the instant real geometry arrives.
      if (!initialCameraSetRef.current) {
        const mode = cameraModeRef.current;
        let framed = false;
        if (mode === "dollhouse") {
          framed = frameDollhouseOnModel(camera, controls, built);
        } else if (mode === "walk" || mode === "fly") {
          const pose = walkStartPose(built, { heightIn: mode === "fly" ? FLY_START_HEIGHT_IN : WALK_EYE_HEIGHT_IN });
          if (pose) {
            camera.position.set(pose.position.x, pose.position.y, pose.position.z);
            camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
            framed = true;
          }
        } else {
          framed = frameCameraOnModel(camera, controls, built);
        }
        if (framed) initialCameraSetRef.current = true;
      }
      builtRef.current = built;

      // A rebuild replaces every mesh, so a live highlight would otherwise
      // vanish on the next keystroke; re-apply it against the new registry.
      applyHighlight(selectionRef.current, design, registryRef, highlightedRef, multiSelectionRef.current);
    }, REBUILD_DEBOUNCE_MS);

    return () => {
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
    };
  }, [design, modelEpoch]);

  // ---- highlight: on selection change, cheap ----
  useEffect(() => {
    applyHighlight(selection, design, registryRef, highlightedRef, multiSelection);
  }, [selection, multiSelection, design]);

  const resetView = () => {
    const mode = cameraModeRef.current;
    if (mode === "dollhouse") frameDollhouseOnModel(cameraRef.current, controlsRef.current, builtRef.current);
    else if (mode === "walk" || mode === "fly") applyWalkStartPose(mode);
    else frameCameraOnModel(cameraRef.current, controlsRef.current, builtRef.current);
  };

  /** Places the camera at the model's center at the mode's start height, facing into the room. */
  const applyWalkStartPose = (mode) => {
    const camera = cameraRef.current;
    const pose = walkStartPose(builtRef.current, {
      heightIn: mode === "fly" ? FLY_START_HEIGHT_IN : WALK_EYE_HEIGHT_IN,
    });
    if (!camera || !pose) return;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  };

  // A camera-mode switch can land mid entity-drag (P1-B editing) or mid
  // gizmo-drag (dragging the ViewCube): the user pressed down, which set
  // dragRef/gizmoDragRef and disabled OrbitControls, then clicked a mode
  // button (a separate DOM element the pointer capture doesn't block) before
  // releasing. onPointerUp will never fire either drag's own cleanup in that
  // case — in Walk/Fly it's guarded off entirely, and even switching straight
  // back to Orbit doesn't reach it, since the original press/release pair is
  // long since over. Left alone, `controls.enabled` stays false until some
  // LATER, unrelated pointerup happens to call the stale drag's cleanup.
  // Force both closed here instead, on every mode switch, regardless of
  // direction.
  const forceEndActiveDrag = () => {
    const mount = mountRef.current;
    const drag = dragRef.current;
    if (drag) {
      if (mount) {
        try {
          mount.releasePointerCapture(drag.pointerId);
        } catch {
          // already released (or never captured); nothing to undo
        }
      }
      dragRef.current = null;
    }
    gizmoDragRef.current = null;
    // Idempotent either way (a no-op if nothing was dragging): always restore
    // it, rather than only when one of the two drag refs was actually set.
    if (controlsRef.current) controlsRef.current.enabled = true;
  };

  // Switches which controls object drives the camera. Orbit and Dollhouse
  // both use OrbitControls (Dollhouse just constrains its polar angle);
  // Walk and Fly both use PointerLockControls. Leaving Walk/Fly always
  // releases the pointer lock and zeroes any residual movement velocity, so
  // re-entering later (or switching to Orbit) never inherits stale motion.
  const setCameraMode = (mode) => {
    if (mode === cameraModeRef.current) return;
    forceEndActiveDrag();
    const wasFirstPerson = cameraModeRef.current === "walk" || cameraModeRef.current === "fly";
    if (wasFirstPerson) {
      resetFirstPersonInputState(moveStateRef, flyVelocityRef, sprintHeldSinceMsRef);
      const plc = pointerLockControlsRef.current;
      if (plc?.isLocked) plc.unlock();
    }
    cameraModeRef.current = mode;
    setCameraModeState(mode);

    const controls = controlsRef.current;
    if (mode === "dollhouse") {
      if (controls) {
        controls.minPolarAngle = DOLLHOUSE_POLAR_RANGE.min;
        controls.maxPolarAngle = DOLLHOUSE_POLAR_RANGE.max;
      }
      frameDollhouseOnModel(cameraRef.current, controls, builtRef.current);
    } else if (mode === "orbit") {
      if (controls) {
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI / 2 - 0.02;
      }
      if (wasFirstPerson) frameCameraOnModel(cameraRef.current, controls, builtRef.current);
    } else if (mode === "walk" || mode === "fly") {
      applyWalkStartPose(mode);
    }
  };

  // Equipment tag labels: hidden by default, toggled from the button cluster.
  // Flips sprite visibility in place -- no scene rebuild.
  const toggleLabels = () => {
    const next = !showLabelsRef.current;
    showLabelsRef.current = next;
    setShowLabels(next);
    const group = contentGroupRef.current;
    if (group) group.traverse((o) => { if (o.isSprite && o.userData.isTagLabel) o.visible = next; });
  };

  // Manual free-roam walkthrough recording: captures exactly what's on
  // screen (any camera mode) to a downloadable video. Requires
  // HTMLCanvasElement.captureStream + MediaRecorder — both are Chrome/
  // Firefox/Edge baseline but not guaranteed everywhere, so the button
  // disables itself rather than throwing when either is missing.
  // Feature-detected once from globals (not from rendererRef, which is only
  // populated after the setup effect runs — checking the ref here would show
  // the Record button as unsupported on every first render, in every browser,
  // until something unrelated happened to trigger a re-render).
  const recordingSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function";

  /** Stops every track on the live recording stream (idempotent — safe to call with nothing active). */
  const releaseRecordingStream = () => {
    const stream = recordingStreamRef.current;
    recordingStreamRef.current = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
  };

  const startRecording = () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas || !recordingSupported) return;

    let stream;
    let recorder;
    try {
      stream = canvas.captureStream(30);
      recordingStreamRef.current = stream;
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
        (t) => window.MediaRecorder.isTypeSupported?.(t),
      );
      recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      // Synchronous startup failure (e.g. an unsupported mimeType slipped past
      // isTypeSupported, or captureStream itself threw). Release whatever got
      // created and leave the UI in "not recording" — never leave a stream
      // running with no button reflecting that it's live.
      releaseRecordingStream();
      return;
    }

    recordedChunksRef.current = [];
    recordingErroredRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    // An in-progress recording can fail asynchronously (the underlying track
    // ends unexpectedly, an encoder error, etc). Whether `stop` also fires
    // after `error` is browser/error-dependent per spec — clean up here
    // unconditionally rather than relying on it, and mark errored so onstop
    // (if it does still fire) skips the download instead of offering a
    // corrupt/incomplete file.
    recorder.onerror = () => {
      recordingErroredRef.current = true;
      releaseRecordingStream();
      recordedChunksRef.current = [];
      mediaRecorderRef.current = null;
      setIsRecording(false);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
      recordedChunksRef.current = [];
      // Explicitly stop every track now that the recorder has fully flushed
      // (stop() fires a final dataavailable before this event, so the blob
      // above already has everything) — otherwise the canvas capture keeps
      // running, tied only to the stream's own GC lifetime, not to the user
      // having pressed Stop. A no-op if onerror already released it.
      releaseRecordingStream();
      // Skip the download if this stop followed a recording error, or if
      // nothing was actually captured (Stop pressed the instant after Start)
      // — either way there's nothing a user should be handed as a video file.
      if (recordingErroredRef.current || blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `forge-walkthrough-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    try {
      recorder.start();
    } catch {
      // start() itself threw synchronously — same cleanup as the constructor
      // failure above; none of the event handlers above will ever fire.
      releaseRecordingStream();
      return;
    }
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const showPointerLockPrompt = (cameraMode === "walk" || cameraMode === "fly") && !pointerLocked;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mountRef} className="h-full w-full" />
      {/* Camera-mode switcher (TrueView-style: Orbit / Walk / Fly / Dollhouse).
          Same pill-group pattern as the 2D/Split/3D toggle elsewhere in the
          designer toolbar. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-slate-700 shadow-lg">
          {[
            { mode: "orbit", label: "Orbit" },
            { mode: "walk", label: "Walk" },
            { mode: "fly", label: "Fly" },
            { mode: "dollhouse", label: "Dollhouse" },
          ].map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCameraMode(mode)}
              aria-pressed={cameraMode === mode}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                cameraMode === mode
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-900/80 text-slate-200 hover:bg-slate-800/90"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* On-screen navigation cluster: labels, record, reset view. Sits BELOW
          the ViewCube gizmo (rendered into the canvas itself, top-right
          corner) so the two never overlap. pointer-events-none on the
          wrapper so drags pass through everywhere except the buttons. */}
      <div className="pointer-events-none absolute right-3 top-[112px] z-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={toggleLabels}
          title={showLabels ? "Hide equipment labels" : "Show equipment labels"}
          aria-label={showLabels ? "Hide equipment labels" : "Show equipment labels"}
          aria-pressed={showLabels}
          className={`pointer-events-auto rounded-lg p-2.5 shadow-lg transition-colors ${
            showLabels
              ? "bg-emerald-500 text-white"
              : "bg-slate-900/80 text-slate-200 hover:bg-slate-800/90"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <circle cx="7" cy="7" r="1.5" />
          </svg>
        </button>
        {recordingSupported && (
          <button
            type="button"
            onClick={toggleRecording}
            title={isRecording ? "Stop recording" : "Record this walkthrough as a video"}
            aria-label={isRecording ? "Stop recording walkthrough" : "Start recording walkthrough"}
            aria-pressed={isRecording}
            className={`pointer-events-auto rounded-lg p-2.5 shadow-lg transition-colors ${
              isRecording
                ? "bg-red-600 text-white"
                : "bg-slate-900/80 text-slate-200 hover:bg-slate-800/90"
            }`}
          >
            {isRecording ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={resetView}
          title="Reset the view"
          aria-label="Reset 3D view"
          className="pointer-events-auto rounded-lg bg-slate-900/80 p-2.5 text-slate-200 shadow-lg transition-colors hover:bg-slate-800/90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12l9-9 9 9" />
            <path d="M5 10v10h14V10" />
          </svg>
        </button>
      </div>
      {isRecording && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
          Recording walkthrough
        </div>
      )}
      {showPointerLockPrompt && (
        <button
          type="button"
          onClick={() => pointerLockControlsRef.current?.lock()}
          className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-slate-950/60 text-center text-slate-100"
        >
          <span className="text-sm font-semibold">Click to look around</span>
          <span className="text-xs text-slate-300">
            WASD or arrow keys to move{cameraMode === "fly" ? " · Space / Shift for up / down" : ""} · Esc to release the pointer
          </span>
        </button>
      )}
      {dispatch && selection && (
        <div
          ref={popupRef}
          className="pointer-events-auto absolute left-0 top-0 z-10"
          style={{ visibility: "hidden" }}
        >
          <Viewport3DSizePopup selection={selection} design={design} dispatch={dispatch} />
        </div>
      )}
    </div>
  );
}

/** Revert any previously highlighted meshes, then tint the newly selected ones. */
export function applyHighlight(selection, design, registryRef, highlightedRef, multiSelection = []) {
  for (const { mesh, originalMaterial } of highlightedRef.current) {
    mesh.material = originalMaterial;
  }
  highlightedRef.current = [];

  // A multi-selection (e.g. a furniture set just placed from Favorites)
  // lights up every piece, not just the single selection.
  const keys = [
    ...highlightKeysForSelection(selection, design),
    ...(multiSelection || []).flatMap((m) => highlightKeysForSelection(m, design)),
  ];
  if (keys.length === 0) return;
  const registry = registryRef.current;
  const seen = new Set();
  for (const key of keys) {
    for (const entry of registry.get(key) || []) {
      // Furniture is registered as its composed THREE.Group (a piece is
      // several parts — legs, seat, back — not one mesh), which has no
      // `.material` of its own. Highlighting it means walking down to the
      // real meshes inside and tinting each of THEIR materials; a wall or
      // glass pane, by contrast, is registered as the mesh itself and needs
      // no walk. Either way, only actual Mesh objects ever reach the tint
      // step below — a Group is never handed to cloneWithHighlight, which
      // is exactly the crash this guards against (a Group has no material
      // to clone).
      const meshes = entry.isMesh ? [entry] : collectMeshes(entry);
      for (const mesh of meshes) {
        if (seen.has(mesh)) continue;
        seen.add(mesh);
        const originalMaterial = mesh.material;
        if (!originalMaterial) continue;
        // Clone rather than mutate: many meshes share one cached material
        // instance, and mutating it in place would highlight every wall in
        // the house, not the one the user selected.
        const highlightMaterial = Array.isArray(originalMaterial)
          ? originalMaterial.map(cloneWithHighlight)
          : cloneWithHighlight(originalMaterial);
        mesh.material = highlightMaterial;
        highlightedRef.current.push({ mesh, originalMaterial });
      }
    }
  }
}

/** Every Mesh inside a Group (or a lone Mesh itself), for highlighting composed furniture. */
function collectMeshes(object) {
  const meshes = [];
  object.traverse?.((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

export function cloneWithHighlight(material) {
  const clone = material.clone();
  clone.emissive = new THREE.Color(HIGHLIGHT_COLOR);
  clone.emissiveIntensity = HIGHLIGHT_INTENSITY;
  // Flags this instance as owned by the highlight system (not the shared
  // material cache), so disposeContentGroup knows to free it — the cache's
  // own materials are disposed once, at unmount, not per rebuild.
  clone.userData.__isHighlightClone = true;
  return clone;
}

/**
 * Replace the scene's content group: add the new one, then REMOVE the old
 * one from the scene and dispose it. Returns the group now in the scene.
 *
 * Removal is the part that matters. Disposing alone leaves the old group in
 * the scene graph, and three.js silently re-uploads a disposed geometry the
 * next time it is rendered — so every rebuild (each step of a drag) left a
 * ghost copy of the house behind and grew GPU memory without bound.
 */
export function swapContentGroup(scene, oldGroup, newGroup) {
  if (newGroup) scene.add(newGroup);
  if (oldGroup && oldGroup !== newGroup) {
    scene.remove(oldGroup);
    disposeContentGroup(oldGroup);
  }
  return newGroup;
}

/** Dispose every geometry (and any per-mesh highlight clone) in a content group. */
export function disposeContentGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    // Tag-label sprites share reference-counted cache textures/materials:
    // release this sprite's reference here. The cache disposes the GPU
    // resources once the last referencing sprite is gone — never per-rebuild
    // while other sprites still use them, and sweepTagSpriteCache() reaps the
    // leftovers on unmount.
    if (obj.isSprite) {
      releaseTagSprite(obj);
      return;
    }
    // Furniture model clones share their template's geometry (owned by the
    // model cache, disposed at unmount); everything else is per-rebuild.
    if (obj.geometry && !obj.userData?.sharedAsset) obj.geometry.dispose();
    // Materials are cache-owned and disposed once at unmount, EXCEPT a
    // highlight clone, which belongs to no cache and must go here.
    if (obj.material && obj.material.userData?.__isHighlightClone) obj.material.dispose();
  });
}
