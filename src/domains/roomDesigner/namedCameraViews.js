// Named 3D camera views for the Designer: save the current camera position and
// orbit target under a name, and return to it later. Pure list and pose logic.
// The viewport owns the live camera; this module only copies numbers in and out.
//
// Views are session-only for now (held in the viewport, never written to the
// design document), so the saved design format does not change.

export const MAX_NAMED_VIEWS = 12;

const isFiniteVec = (v) =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** A plain copy of the camera pose: no references to the live three.js objects. */
export function poseFromCamera(camera, target) {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
  };
}

export function isCameraPose(pose) {
  return Boolean(pose) && isFiniteVec(pose.position) && isFiniteVec(pose.target);
}

let nextId = 1;

/**
 * Add a view, or replace the one with the same name. Returns a new array. A blank
 * name, an invalid pose, or a full list leaves the list unchanged.
 */
export function addNamedView(views, rawName, pose) {
  const name = String(rawName ?? "").trim();
  if (!name || !isCameraPose(pose)) return views;
  const copy = { position: { ...pose.position }, target: { ...pose.target } };
  const existing = views.find((v) => v.name === name);
  if (existing) {
    return views.map((v) => (v.id === existing.id ? { ...v, pose: copy } : v));
  }
  if (views.length >= MAX_NAMED_VIEWS) return views;
  nextId += 1;
  return [...views, { id: `view-${nextId}`, name, pose: copy }];
}

export function removeNamedView(views, id) {
  return views.filter((v) => v.id !== id);
}

/** The next free "View N" name, so a quick save never needs typing. */
export function nextViewName(views) {
  let n = views.length + 1;
  while (views.some((v) => v.name === `View ${n}`)) n += 1;
  return `View ${n}`;
}
