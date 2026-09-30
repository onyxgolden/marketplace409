// 3D furniture: vendored CC0 model templates and procedural part geometry.
//
// createFurnitureModelCache loads each model URL ONCE (GLTFLoader, part of
// three — no new dependency) and hands out per-piece clones that share the
// template's geometry and materials. Clone meshes are flagged
// userData.sharedAsset so a scene rebuild never disposes GPU resources that
// other pieces (and later rebuilds) still use; the cache disposes templates
// once, at viewport unmount.
//
// Until a model is ready — or if it is missing or corrupt — instantiate()
// returns null and the viewport renders the piece's procedural parts
// instead, so a saved design never breaks. onChange fires when a model
// becomes ready or fails, so the viewport can rebuild.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * A per-instance clone of `material` tinted to `color`, memoized by source
 * material within one `instantiate()` call (via `cache`) — a model with
 * several meshes sharing one source material (Kenney's kit reuses materials
 * across parts) gets one tinted clone, not one per mesh. Flagged so
 * disposeContentGroup (DesignerViewport3D.jsx) knows to dispose it on
 * rebuild; unlike the shared template material, nothing else owns it.
 */
function tintedMaterialClone(material, color, cache) {
  if (!material) return material;
  const existing = cache.get(material);
  if (existing) return existing;
  const clone = material.clone();
  clone.color = new THREE.Color(color);
  clone.userData.__isFurnitureColorClone = true;
  cache.set(material, clone);
  return clone;
}

export function createFurnitureModelCache({ loader = new GLTFLoader(), onChange = () => {}, warn = (...a) => console.warn(...a) } = {}) {
  const entries = new Map(); // url -> { status, template?, offset? }
  let disposed = false;

  const disposeObject = (root) => {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  };

  function request(url) {
    if (disposed || entries.has(url)) return;
    const entry = { status: "loading" };
    entries.set(url, entry);
    loader.load(
      url,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const template = gltf.scene;
        template.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(template);
        const center = box.getCenter(new THREE.Vector3());
        // Offset that puts the model's footprint centre at the origin and
        // its lowest point on the floor.
        entry.offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
        entry.template = template;
        entry.status = "ready";
        onChange(url, "ready");
      },
      undefined,
      (error) => {
        if (disposed) return;
        entry.status = "failed";
        warn(`Furniture model failed to load; using the built-in shape instead: ${url}`, error?.message || error);
        onChange(url, "failed");
      },
    );
  }

  /** "loading" | "ready" | "failed" | "disposed" | undefined. */
  function status(url) {
    if (disposed) return "disposed";
    return entries.get(url)?.status;
  }

  /**
   * A placed model for `asset` scaled by `fit` (see fitFurnitureModel), or
   * null while loading / after a failure (starts loading on first call).
   *
   * `color`, when given, recolors every material in the clone to the
   * catalog/item color — the same uniform recolor the procedural-parts
   * fallback already applies via `stdMaterial({ color: part.color ||
   * item.color })`, so switching between a loaded model and its procedural
   * fallback (e.g. while the model is still downloading) never changes the
   * piece's color. This tints legs/trim/frame the same as the main body —
   * a disclosed simplification, since nothing in the asset manifest
   * distinguishes which of a model's several materials is its "primary"
   * one. Recoloring means these meshes get their OWN material instances
   * (flagged __isFurnitureColorClone) rather than sharing the template's —
   * see disposeContentGroup, which must dispose these on every rebuild or
   * they leak GPU resources the way a highlight clone would.
   */
  function instantiate(asset, fit, color) {
    request(asset.url);
    const entry = entries.get(asset.url);
    if (!entry || entry.status !== "ready") return null;
    const inner = entry.template.clone(true); // shares geometry + materials
    inner.position.add(entry.offset);
    const tinted = new Map(); // one clone per source material, not per mesh
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.sharedAsset = true; // geometry always stays shared with the template
      if (color) {
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => tintedMaterialClone(m, color, tinted))
          : tintedMaterialClone(o.material, color, tinted);
      }
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const placed = new THREE.Group();
    placed.add(inner);
    placed.scale.set(fit.scale.x, fit.scale.y, fit.scale.z);
    placed.userData.furnitureModel = asset.assetId;
    return placed;
  }

  function dispose() {
    disposed = true;
    for (const entry of entries.values()) if (entry.template) disposeObject(entry.template);
    entries.clear();
  }

  return { request, status, instantiate, dispose };
}

/**
 * Geometry for one procedural part descriptor (designerFurnitureParts.js).
 * Boxes and round cylinders are built exactly as before; "cyl" parts may
 * taper (wTop) and be oval (d != w: z is scaled by d / max(w, wTop)).
 */
export function furniturePartGeometry(part) {
  if (part.shape !== "cyl") return new THREE.BoxGeometry(part.w, part.h, part.d);
  const top = part.wTop ?? part.w;
  const geo = new THREE.CylinderGeometry(top / 2, part.w / 2, part.h, 20);
  const widest = Math.max(part.w, top);
  if (part.d && Math.abs(part.d - widest) > 1e-9) geo.scale(1, 1, part.d / widest);
  return geo;
}
