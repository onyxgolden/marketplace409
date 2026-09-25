/**
 * One-tap placement: where a tapped favorite lands, and what gets selected.
 *
 * Tapping a favorite places it immediately instead of arming a tool and
 * waiting for a canvas click, so the point has to be decided for the user:
 * the middle of whatever they are looking at. In the 2D plan that is the
 * center of the visible viewport; in the 3D view it is the spot on the floor
 * the camera orbits around. Both panes report those centers; this module
 * only chooses between them, snaps, and falls back sensibly.
 *
 * Pure and framework-free, like the rest of customShapes.
 */

import { DEFAULT_GRID_IN, snapScalar } from "../designerGeometry";

const FALLBACK_POINT = Object.freeze({ x: 240, y: 240 });

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Center of the design's walls and furniture, or null for an empty design. */
function designCenter(design) {
  const xs = [];
  const ys = [];
  for (const w of design?.walls || []) {
    xs.push(w.a.x, w.b.x);
    ys.push(w.a.y, w.b.y);
  }
  for (const f of design?.furniture || []) {
    xs.push(f.x);
    ys.push(f.y);
  }
  if (xs.length === 0) return null;
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * The plan point a one-tap placement should be centered on.
 *
 * view        "2d" | "3d" | "split" — the pane the user is looking at wins
 *             (split prefers the 2D plan, where placement is most precise)
 * planCenter  center of the visible 2D viewport, in plan inches (or null)
 * floorCenter 3D orbit target projected to the plan (or null)
 */
export function oneTapPlacementPoint({ view, planCenter, floorCenter, design }) {
  const candidates = view === "3d" ? [floorCenter, planCenter] : [planCenter, floorCenter];
  const chosen = candidates.find(isPoint) || designCenter(design) || FALLBACK_POINT;
  if (design?.settings?.snapEnabled === false) return { x: chosen.x, y: chosen.y };
  const gridIn = design?.settings?.gridIn > 0 ? design.settings.gridIn : DEFAULT_GRID_IN;
  return { x: snapScalar(chosen.x, gridIn), y: snapScalar(chosen.y, gridIn) };
}

/**
 * What to select after a placement, from the design before and after it:
 * the placed furniture (several pieces → a multi-selection, so the whole set
 * can be moved together), else the placed room, else the placed wall.
 * Returns { selection, multiSelection }.
 */
export function placedSelection(before, after) {
  const newOnes = (key) => {
    const old = new Set((before?.[key] || []).map((e) => e.id));
    return (after?.[key] || []).filter((e) => !old.has(e.id));
  };
  const furniture = newOnes("furniture");
  if (furniture.length > 1) {
    return { selection: null, multiSelection: furniture.map((f) => ({ kind: "furniture", id: f.id })) };
  }
  if (furniture.length === 1) {
    return { selection: { kind: "furniture", id: furniture[0].id }, multiSelection: [] };
  }
  const [room] = newOnes("rooms");
  if (room) return { selection: { kind: "room", id: room.id }, multiSelection: [] };
  const [wall] = newOnes("walls");
  if (wall) return { selection: { kind: "wall", id: wall.id }, multiSelection: [] };
  return { selection: null, multiSelection: [] };
}
