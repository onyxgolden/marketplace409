/**
 * Starter favorites: a small set of ready-made shapes every user's library
 * begins with, so the Favorites section is useful before anyone saves their
 * own.
 *
 * Each starter is BUILT, not hand-written: a throwaway design is composed with
 * the real document functions (addWall, addOpening, placeFurniture) and then
 * run through captureSelection — the same path a user's "Save as shape" takes.
 * So a starter can never drift out of shape with what the document model and
 * the insert path expect; if the model changes, the starters change with it.
 *
 * Names are generic industry terms only.
 *
 * Seeding happens once per library (starterSeeded). A user who deletes or
 * unstars a starter keeps it that way — it is never re-added behind their back.
 */

import {
  addOpening,
  addWall,
  createEmptyDesign,
  placeFurniture,
} from "../designerDocument";
import { captureSelection } from "./customShapeCapture";
import { MAX_LIBRARY_SIZE } from "./customShapeErrors";
import { orderedFavoriteIds } from "./customShapeLibrary";

/** Stable id prefix, so a starter is recognisable and never duplicated. */
export const STARTER_ID_PREFIX = "starter-";

/** A closed rectangular room (walls + room record) with its top-left at the origin. */
function walledRoom(design, idBase, widthIn, depthIn) {
  const corners = [
    { x: 0, y: 0 },
    { x: widthIn, y: 0 },
    { x: widthIn, y: depthIn },
    { x: 0, y: depthIn },
  ];
  let next = design;
  const wallIds = [];
  corners.forEach((a, i) => {
    const id = `${idBase}-w${i}`;
    next = addWall(next, a, corners[(i + 1) % 4], { id });
    wallIds.push(id);
  });
  const room = { id: `${idBase}-room`, label: "", wallIds, polygon: corners.map((p) => ({ ...p })) };
  return { design: { ...next, rooms: [...next.rooms, room] }, roomId: room.id, wallIds };
}

/** Place pieces and return the design plus a multi-selection of them. */
function furnitureSet(pieces) {
  let design = createEmptyDesign("starter");
  for (const [catalogId, x, y, rotationDeg = 0] of pieces) {
    design = placeFurniture(design, catalogId, x, y, rotationDeg);
  }
  return captureSelection(design, null, design.furniture.map((f) => ({ kind: "furniture", id: f.id })));
}

/** A walled room with a door on its bottom wall and furniture inside. */
function roomWithDoor(idBase, widthIn, depthIn, doorOffsetIn, doorWidthIn, pieces) {
  const built = walledRoom(createEmptyDesign("starter"), idBase, widthIn, depthIn);
  // Wall 2 runs bottom-right -> bottom-left; its offset is measured from the right.
  let design = addOpening(built.design, built.wallIds[2], {
    type: "door",
    offsetIn: doorOffsetIn,
    widthIn: doorWidthIn,
  });
  for (const [catalogId, x, y, rotationDeg = 0] of pieces) {
    design = placeFurniture(design, catalogId, x, y, rotationDeg);
  }
  return captureSelection(design, { kind: "room", id: built.roomId });
}

/**
 * The starter definitions, in the order they appear in Favorites.
 * Furniture coordinates are piece centers, in inches.
 */
const STARTERS = [
  {
    slug: "dining-set",
    name: "Dining set (6-seat)",
    build: () =>
      furnitureSet([
        ["dining-table-rect", 60, 40],
        ["dining-chair", 36, 13, 180], ["dining-chair", 60, 13, 180], ["dining-chair", 84, 13, 180],
        ["dining-chair", 36, 67], ["dining-chair", 60, 67], ["dining-chair", 84, 67],
      ]),
  },
  {
    slug: "living-seating",
    name: "Living room seating",
    build: () =>
      furnitureSet([
        ["sofa-3seat", 66, 18],
        ["coffee-table", 66, 66],
        ["armchair", 18, 70, 90], ["armchair", 114, 70, 270],
      ]),
  },
  {
    slug: "queen-bedroom",
    name: "Queen bed + nightstands",
    build: () =>
      furnitureSet([
        ["nightstand", 12, 12], ["bed-queen", 54, 40], ["nightstand", 96, 12],
      ]),
  },
  {
    slug: "home-office",
    name: "Home office desk",
    build: () =>
      furnitureSet([
        ["desk", 24, 12], ["office-chair", 24, 42], ["bookshelf", 78, 6],
      ]),
  },
  {
    slug: "kitchen-island",
    name: "Kitchen island with seating",
    build: () =>
      furnitureSet([
        ["kitchen-island", 36, 18],
        ["dining-chair", 12, 46], ["dining-chair", 36, 46], ["dining-chair", 60, 46],
      ]),
  },
  {
    slug: "laundry",
    name: "Laundry (washer, dryer, sink)",
    build: () =>
      furnitureSet([
        ["washer", 13.5, 13.5], ["dryer", 41.5, 13.5], ["utility-sink", 69, 10],
      ]),
  },
  {
    slug: "full-bath",
    name: "Full bath (5' × 8')",
    build: () =>
      roomWithDoor("starter-full-bath", 60, 96, 6, 30, [
        ["bathtub", 30, 16],
        ["toilet", 46, 50, 270],
        ["vanity-single", 18, 76, 90],
      ]),
  },
  {
    slug: "powder-room",
    name: "Powder room (5' × 5')",
    build: () =>
      roomWithDoor("starter-powder-room", 60, 60, 6, 28, [
        ["toilet", 44, 14],
        ["sink-pedestal", 14, 12],
      ]),
  },
  {
    slug: "walk-in-closet",
    name: "Walk-in closet (6' × 8')",
    build: () =>
      roomWithDoor("starter-walk-in-closet", 72, 96, 18, 30, [
        ["wardrobe", 36, 14],
        ["dresser", 12, 50, 90],
      ]),
  },
];

/**
 * Give every entity a stable id derived from the starter's slug. The document
 * functions draw ids from a global counter, so without this a starter's ids
 * would depend on whatever was built before it. References (room.wallIds,
 * opening.wallId) are rewritten to match. Placing a shape re-ids everything
 * anyway; this is about the stored record being identical on every build.
 */
function stableIds(slug, entities) {
  const map = new Map();
  const renumber = (kind, list) =>
    list.map((item, i) => {
      const id = `${STARTER_ID_PREFIX}${slug}-${kind}${i}`;
      map.set(item.id, id);
      return { ...item, id };
    });
  const walls = renumber("w", entities.walls);
  const furniture = renumber("f", entities.furniture);
  const openings = renumber("o", entities.openings).map((o) => ({ ...o, wallId: map.get(o.wallId) ?? o.wallId }));
  const rooms = renumber("r", entities.rooms).map((r) => ({
    ...r,
    wallIds: (r.wallIds || []).map((id) => map.get(id) ?? id),
  }));
  return { ...entities, walls, rooms, openings, furniture };
}

/** Starter shape records, ready to be added to a library. Pure and deterministic. */
export function buildStarterShapes() {
  return STARTERS.map(({ slug, name, build }) => {
    const built = build();
    const capture = { ...built, entities: stableIds(slug, built.entities) };
    return {
      id: `${STARTER_ID_PREFIX}${slug}`,
      name,
      createdAt: 0,
      updatedAt: 0,
      favorite: true,
      bounds: { ...capture.bounds },
      counts: { ...capture.counts },
      entities: capture.entities,
    };
  });
}

/**
 * Give a library its starter favorites, once.
 *
 * Already-seeded libraries come back unchanged (so a starter the user deleted
 * stays deleted). A starter whose id or name the user already has is skipped
 * rather than duplicated. New starters are appended to the END of Favorites,
 * after anything the user starred themselves.
 */
export function seedStarterFavorites(library) {
  if (!library || library.starterSeeded === true) return library;
  const ids = new Set(library.shapes.map((s) => s.id));
  const names = new Set(library.shapes.map((s) => s.name.toLowerCase()));
  const room = Math.max(0, MAX_LIBRARY_SIZE - library.shapes.length);
  const starters = buildStarterShapes()
    .filter((s) => !ids.has(s.id) && !names.has(s.name.toLowerCase()))
    .slice(0, room);
  return {
    ...library,
    shapes: [...library.shapes, ...starters],
    favoriteOrder: [...orderedFavoriteIds(library), ...starters.map((s) => s.id)],
    starterSeeded: true,
  };
}
