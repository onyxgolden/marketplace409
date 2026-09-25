"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  buildThreeScene,
  highlightKeysForSelection,
  highlightRegistryKey,
} from "@/domains/roomDesigner/designerThreeModel";
import { furnitureParts } from "@/domains/roomDesigner/designerFurnitureParts";
import {
  beginDrag3D,
  dragStep3D,
  isClickGesture,
  planPointFromWorld,
  popupAnchorForSelection,
  selectionFromPick,
} from "@/domains/roomDesigner/designer3DEditing";
import Viewport3DSizePopup from "./Viewport3DSizePopup";
import {
  acquireTextureCaches,
  plasterTexture,
  releaseTextureCaches,
  skyTexture,
  woodFloorTexture,
} from "./designerThreeTextures";

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

/** Debounce for content rebuilds: rapid drags/keystrokes coalesce into one rebuild. */
const REBUILD_DEBOUNCE_MS = 120;

/** Highlight tint applied to the selected entity's meshes. Cheap: a per-mesh material clone, not a scene rebuild. */
const HIGHLIGHT_COLOR = 0x2dd4bf; // emerald/teal, distinct from the warm interior palette
const HIGHLIGHT_INTENSITY = 0.85;

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
export default function DesignerViewport3D({ design, selection = null, dispatch = null }) {
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
  const registryRef = useRef(new Map());
  const highlightedRef = useRef([]); // [{ mesh, originalMaterial }]
  const tierRef = useRef(TIERS.balanced);
  const tierNameRef = useRef("balanced");
  const initialCameraSetRef = useRef(false);
  const rebuildTimerRef = useRef(null);
  const selectionRef = useRef(selection);
  const designRef = useRef(design);
  const dispatchRef = useRef(dispatch);
  const popupRef = useRef(null);
  const popupAnchorRef = useRef(null);
  useEffect(() => {
    selectionRef.current = selection;
    designRef.current = design;
    dispatchRef.current = dispatch;
    popupAnchorRef.current = popupAnchorForSelection(selection, design);
  }, [selection, design, dispatch]);
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

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(threeScene, camera);
      placePopup();
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
      for (const m of materialCacheRef.current.values()) m.dispose();
      materialCacheRef.current.clear();
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

      // furniture: composed groups from pure part descriptors
      for (const item of built.furniture) {
        const fGroup = new THREE.Group();
        const parts = furnitureParts(item.catalogId || "unknown", {
          widthIn: item.widthIn, depthIn: item.depthIn, heightIn: item.heightIn, color: item.color,
        });
        for (const part of parts) {
          const geo =
            part.shape === "cyl"
              ? new THREE.CylinderGeometry(part.w / 2, part.w / 2, part.h, 20)
              : new THREE.BoxGeometry(part.w, part.h, part.d);
          const mat = stdMaterial({ color: part.color || item.color, roughness: 0.8 });
          const mesh = shadowed(new THREE.Mesh(geo, mat));
          mesh.position.set(part.dx, part.dy, part.dz);
          if (part.rotX) mesh.rotation.x = part.rotX;
          fGroup.add(mesh);
        }
        fGroup.position.set(item.x, 0, item.z);
        fGroup.rotation.y = item.rotY;
        group.add(fGroup);
        fGroup.userData.entityKind = "furniture";
        fGroup.userData.entityId = item.id;
        register(highlightRegistryKey("furniture", item.id), fGroup);
      }

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
      if (camera && controls && !initialCameraSetRef.current && built.floor) {
        const cx = built.floor ? (built.floor.minX + built.floor.maxX) / 2 : 0;
        const cz = built.floor ? (built.floor.minZ + built.floor.maxZ) / 2 : 0;
        camera.position.set(cx + floorSize * 0.55, floorSize * 0.75, cz + floorSize * 0.55);
        camera.far = floorSize * 20;
        camera.updateProjectionMatrix();
        controls.target.set(cx, 0, cz);
        controls.update();
        initialCameraSetRef.current = true;
      }

      // A rebuild replaces every mesh, so a live highlight would otherwise
      // vanish on the next keystroke; re-apply it against the new registry.
      applyHighlight(selectionRef.current, design, registryRef, highlightedRef);
    }, REBUILD_DEBOUNCE_MS);

    return () => {
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
    };
  }, [design]);

  // ---- highlight: on selection change, cheap ----
  useEffect(() => {
    applyHighlight(selection, design, registryRef, highlightedRef);
  }, [selection, design]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mountRef} className="h-full w-full" />
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
export function applyHighlight(selection, design, registryRef, highlightedRef) {
  for (const { mesh, originalMaterial } of highlightedRef.current) {
    mesh.material = originalMaterial;
  }
  highlightedRef.current = [];

  const keys = highlightKeysForSelection(selection, design);
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
function disposeContentGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    // Materials are cache-owned and disposed once at unmount, EXCEPT a
    // highlight clone, which belongs to no cache and must go here.
    if (obj.material && obj.material.userData?.__isHighlightClone) obj.material.dispose();
  });
}
