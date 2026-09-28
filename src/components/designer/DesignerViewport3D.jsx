"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  } else if (eq.shape === "rack" && Array.isArray(eq.members)) {
    // Parametric pipe rack / sleeper rack (rackGeometry.rackMembers3D):
    // columns, beams, struts and knee braces in steel; sleeper piers in
    // concrete. One shared geometry per member size keeps it light.
    const concrete = stdMaterial({ color: "#9ca3af", roughness: 0.9 });
    const geos = new Map();
    for (const m of eq.members) {
      const key = `${m.sx}|${m.sy}|${m.sz}`;
      if (!geos.has(key)) geos.set(key, new THREE.BoxGeometry(m.sx, m.sy, m.sz));
      const mesh = shadowed(new THREE.Mesh(geos.get(key), m.kind === "pier" ? concrete : mat));
      mesh.position.set(m.x, m.y, m.z);
      if (m.rotX) mesh.rotation.x = m.rotX;
      mesh.userData.rackMember = m.kind;
      group.add(mesh);
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
  const spinRef = useRef(false); // 360° auto-orbit; mirrored into `spin` state for the button
  const builtRef = useRef(null); // last buildThreeScene descriptor, for reset-view
  const [spin, setSpin] = useState(false);
  // Equipment tag labels (P-101, E-102, …): hidden by default, flipped by the
  // Labels toggle beside the 360° button. Sprites are collected per scene build
  // (they're rebuilt with the scene); the ref mirror avoids rebuilding the
  // whole scene just to flip visibility.
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
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(threeScene, camera);
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
    let drag = null; // { state, plane, pointerId } while moving an entity

    // Capture phase on the mount element: runs before OrbitControls' own
    // listener on the canvas, so an entity drag can claim the gesture
    // (stopPropagation) before the camera starts orbiting.
    const onPointerDown = (e) => {
      // TrueView-style: grabbing the model interrupts a 360° auto-orbit.
      // This runs before the dispatch gate on purpose — the sample viewer is
      // read-only (no dispatch) and the toggle must still stop there.
      if (spinRef.current) {
        spinRef.current = false;
        setSpin(false);
        if (controlsRef.current) controlsRef.current.autoRotate = false;
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
      drag = { state, plane, pointerId: e.pointerId };
      controls.enabled = false;
      try {
        mount.setPointerCapture(e.pointerId);
      } catch {
        // capture is a nicety (drag continues outside the pane); never fatal
      }
      e.stopPropagation();
    };
    const onPointerMove = (e) => {
      if (drag) {
        if (!castFrom(e) || !raycaster.ray.intersectPlane(drag.plane, planeHit)) return;
        const step = dragStep3D(drag.state, designRef.current, planPointFromWorld(planeHit));
        drag.state = step.drag;
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
      if (!drag) return false;
      try {
        mount.releasePointerCapture(drag.pointerId);
      } catch {
        // already released (or never captured); nothing to undo
      }
      drag = null;
      controls.enabled = true;
      e.stopPropagation();
      return true;
    };
    const onPointerUp = (e) => {
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
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
      controls.dispose();
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
      if (!initialCameraSetRef.current) {
        if (frameCameraOnModel(camera, controls, built)) initialCameraSetRef.current = true;
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

  // TrueView-style continuous 360° orbit: tap to spin, tap again (or grab
  // the model) to stop. OrbitControls applies autoRotate inside its update(),
  // which the render loop already calls every frame.
  const toggleSpin = () => {
    const next = !spinRef.current;
    spinRef.current = next;
    setSpin(next);
    const controls = controlsRef.current;
    if (controls) {
      controls.autoRotate = next;
      controls.autoRotateSpeed = 1.8;
    }
  };

  const resetView = () => {
    if (spinRef.current) {
      spinRef.current = false;
      setSpin(false);
      if (controlsRef.current) controlsRef.current.autoRotate = false;
    }
    frameCameraOnModel(cameraRef.current, controlsRef.current, builtRef.current);
  };

  // Equipment tag labels: hidden by default, toggled beside the 360° button.
  // Flips sprite visibility in place -- no scene rebuild.
  const toggleLabels = () => {
    const next = !showLabelsRef.current;
    showLabelsRef.current = next;
    setShowLabels(next);
    const group = contentGroupRef.current;
    if (group) group.traverse((o) => { if (o.isSprite && o.userData.isTagLabel) o.visible = next; });
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mountRef} className="h-full w-full" />
      {/* On-screen navigation cluster (TrueView / Google Earth pattern):
          360° auto-orbit toggle + reset view. pointer-events-none on the
          wrapper so drags pass through everywhere except the buttons. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={toggleSpin}
          title={spin ? "Stop the 360° orbit" : "Start a 360° orbit"}
          aria-label={spin ? "Stop 360 degree orbit" : "Start 360 degree orbit"}
          aria-pressed={spin}
          className={`pointer-events-auto rounded-lg p-2.5 shadow-lg transition-colors ${
            spin
              ? "bg-emerald-500 text-white"
              : "bg-slate-900/80 text-slate-200 hover:bg-slate-800/90"
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
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
