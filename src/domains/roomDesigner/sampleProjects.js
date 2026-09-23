// Reusable sample-project seed definitions for FORGE Home Designer.
//
// A sample project is a *seed definition*, not a stored project: the
// generator below builds a complete, valid HomeProject envelope from the
// real domain functions (addWall, addOpening, placeFurniture, ...), and the
// UI forks it into the caller's own project via POST + PUT. The generated
// document deliberately carries NO identity — no projectId, no owner/user
// fields, no createdAt/updatedAt, no draft metadata. Identity is assigned
// at fork time by the server (new projectId, new owner_id, fresh row
// timestamps), so the local draft key `forge-designer-draft:<projectId>`
// can never collide with the sample seed identifier.
//
// Stairs: there is no native stair symbol yet, so the stairwell is drawn
// as an annotation group (closed outline path + tread lines + an UP/DOWN
// label) tagged with STAIR_ANNOTATION_SOURCE. Future native stair support
// can find and replace that group; nothing else depends on furniture
// semantics for the stairs.

import {
  addOpening,
  addWall,
  createEmptyDesign,
  placeFurniture,
  resetDesignerIds,
} from "./designerDocument";
import {
  addLevel,
  createHomeProject,
  renameLevel,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";

export const SAMPLE_SEED_ID = "maplewood-two-story";
export const SAMPLE_NAME = "Maplewood Two-Story";

/** Tag on every stair annotation; the seam future native stairs replace. */
export const STAIR_ANNOTATION_SOURCE = "sample-project-stair";

/**
 * Stairwell footprint in inches, identical on both floors (y grows
 * downward, like the canvas). Exported so tests can assert the two floors'
 * stair boxes are spatially aligned.
 */
export const STAIR_BOX = Object.freeze({ x1: 228, y1: 152, x2: 288, y2: 256 });

let sampleSequence = 0;
function sampleId(prefix) {
  sampleSequence += 1;
  return `smp_${prefix}_${sampleSequence}`;
}
/** Test hook: restart sample id generation so output stays deterministic. */
export function resetSampleProjectIds() {
  sampleSequence = 0;
}

function buildWalls(design, walls) {
  let next = design;
  for (const [id, ax, ay, bx, by] of walls) {
    next = addWall(next, { x: ax, y: ay }, { x: bx, y: by }, { id });
  }
  return next;
}

function cutOpenings(design, openings) {
  let next = design;
  for (const [wallId, type, offsetIn, widthIn] of openings) {
    next = addOpening(next, wallId, { type, offsetIn, widthIn });
  }
  return next;
}

function placeFurnishings(design, pieces) {
  let next = design;
  for (const [catalogId, x, y, rotationDeg = 0] of pieces) {
    next = placeFurniture(next, catalogId, x, y, rotationDeg);
  }
  return next;
}

function labelRooms(design, rooms) {
  let next = design;
  for (const [label, x1, y1, x2, y2] of rooms) {
    const room = {
      id: sampleId("room"),
      label,
      polygon: [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ],
    };
    next = { ...next, rooms: [...next.rooms, room] };
  }
  return next;
}

/**
 * Stairwell annotation group: closed outline + tread lines + an UP/DOWN
 * label, all tagged with STAIR_ANNOTATION_SOURCE. floor is 1 or 2.
 */
function stairAnnotations(floor) {
  const { x1, y1, x2, y2 } = STAIR_BOX;
  const group = [
    {
      id: sampleId("stair-outline"),
      kind: "path",
      closed: true,
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ],
      strokeWidthIn: 1,
      source: STAIR_ANNOTATION_SOURCE,
    },
  ];
  // 7 tread lines, evenly spaced (104" run / 8).
  for (let i = 1; i <= 7; i += 1) {
    const y = y1 + ((y2 - y1) * i) / 8;
    group.push({
      id: sampleId("stair-tread"),
      kind: "path",
      points: [
        { x: x1, y },
        { x: x2, y },
      ],
      strokeWidthIn: 0.75,
      source: STAIR_ANNOTATION_SOURCE,
    });
  }
  group.push({
    id: sampleId("stair-label"),
    kind: "label",
    points: [{ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }],
    text: floor === 1 ? "UP" : "DOWN",
    source: STAIR_ANNOTATION_SOURCE,
  });
  return group;
}

// ---------------------------------------------------------------------------
// First floor: 28' x 32' (336" x 384"). Living/kitchen north, foyer/dining
// south-west, stair hall + powder + mudroom east.
// ---------------------------------------------------------------------------

const F1_WALLS = [
  ["f1_wn", 0, 0, 336, 0],
  ["f1_we", 336, 0, 336, 384],
  ["f1_ws", 336, 384, 0, 384],
  ["f1_ww", 0, 384, 0, 0],
  ["f1_i_x216n", 216, 0, 216, 192],
  ["f1_i_y192", 0, 192, 216, 192],
  ["f1_i_x120", 120, 192, 120, 384],
  ["f1_i_x216s", 216, 192, 216, 384],
  ["f1_i_y144", 216, 144, 336, 144],
  ["f1_i_x300", 300, 144, 300, 264],
  ["f1_i_y264", 216, 264, 336, 264],
];

// [wallId, type, offsetIn, widthIn]; offsets measured from the wall's a-end.
const F1_OPENINGS = [
  ["f1_ws", "door", 150, 36], // front door
  ["f1_i_y192", "door", 36, 36], // living -> foyer
  ["f1_i_x120", "door", 48, 48], // foyer -> dining (cased)
  ["f1_i_x216n", "door", 60, 36], // living -> kitchen
  ["f1_i_y144", "door", 6, 36], // kitchen -> stair hall
  ["f1_i_x300", "door", 36, 30], // stair hall -> powder
  ["f1_i_y264", "door", 6, 36], // stair hall -> mudroom
  ["f1_i_x216s", "door", 108, 36], // dining -> mudroom
  ["f1_ws", "door", 60, 36], // mudroom back door
  ["f1_wn", "window", 48, 48], // living
  ["f1_wn", "window", 120, 48], // living
  ["f1_ww", "window", 288, 48], // living
  ["f1_wn", "window", 240, 48], // kitchen
  ["f1_we", "window", 288, 48], // kitchen
  ["f1_ww", "window", 96, 48], // dining
  ["f1_ww", "window", 36, 48], // foyer
  ["f1_we", "window", 168, 36], // powder
  ["f1_we", "window", 48, 36], // mudroom
];

const F1_FURNITURE = [
  ["sofa-3seat", 56, 44],
  ["coffee-table", 56, 108],
  ["armchair", 150, 56],
  ["tv-stand", 108, 160],
  ["floor-lamp", 196, 160],
  ["kitchen-island", 262, 70],
  ["refrigerator", 312, 24],
  ["range", 234, 24],
  ["dishwasher", 300, 116],
  ["cabinet-sink-36", 258, 122],
  ["dining-table-rect", 168, 280, 90],
  ["dining-chair", 140, 250],
  ["dining-chair", 140, 310],
  ["dining-chair", 196, 250],
  ["dining-chair", 196, 310],
  ["side-table", 30, 230],
  ["floor-lamp", 90, 350],
  ["toilet", 318, 170],
  ["sink-pedestal", 318, 220],
  ["washer", 244, 310],
  ["dryer", 244, 350],
  ["storage-chest", 300, 350],
];

const F1_ROOMS = [
  ["Living room", 0, 0, 216, 192],
  ["Kitchen", 216, 0, 336, 144],
  ["Foyer", 0, 192, 120, 384],
  ["Dining room", 120, 192, 216, 384],
  ["Stair hall", 216, 144, 300, 264],
  ["Powder", 300, 144, 336, 264],
  ["Mudroom", 216, 264, 336, 384],
];

// ---------------------------------------------------------------------------
// Second floor: same footprint. Primary suite south-west (ensuite + WIC),
// bedroom 3 north-west, bedroom 2 north-east, stair hall + full bath east.
// ---------------------------------------------------------------------------

const F2_WALLS = [
  ["f2_wn", 0, 0, 336, 0],
  ["f2_we", 336, 0, 336, 384],
  ["f2_ws", 336, 384, 0, 384],
  ["f2_ww", 0, 384, 0, 0],
  ["f2_i_x216", 216, 0, 216, 384],
  ["f2_i_y192", 0, 192, 216, 192],
  ["f2_i_x96", 96, 288, 96, 384],
  ["f2_i_y288", 0, 288, 192, 288],
  ["f2_i_x192", 192, 288, 192, 384],
  ["f2_i_y144", 216, 144, 336, 144],
  ["f2_i_y264", 216, 264, 336, 264],
];

const F2_OPENINGS = [
  ["f2_i_y288", "door", 24, 36], // primary -> ensuite
  ["f2_i_y288", "door", 120, 36], // primary -> walk-in closet
  ["f2_i_x216", "door", 240, 36], // stair hall -> primary
  ["f2_i_x216", "door", 60, 36], // stair hall -> bedroom 3
  ["f2_i_y144", "door", 6, 36], // stair hall -> bedroom 2
  ["f2_i_y264", "door", 6, 36], // stair hall -> full bath
  ["f2_wn", "window", 48, 48], // bedroom 3
  ["f2_wn", "window", 120, 48], // bedroom 3
  ["f2_ww", "window", 288, 48], // bedroom 3
  ["f2_ws", "window", 240, 48], // primary
  ["f2_ww", "window", 96, 48], // primary
  ["f2_ws", "window", 294, 36], // ensuite
  ["f2_wn", "window", 240, 48], // bedroom 2
  ["f2_we", "window", 288, 48], // bedroom 2
  ["f2_we", "window", 36, 48], // full bath
  ["f2_ws", "window", 48, 48], // full bath
  ["f2_we", "window", 168, 48], // stair hall
];

const F2_FURNITURE = [
  ["bed-king", 48, 240],
  ["nightstand", 104, 216],
  ["nightstand", 104, 264],
  ["dresser", 150, 250],
  ["toilet", 28, 312],
  ["vanity-single", 62, 366],
  ["shower", 24, 350],
  ["wardrobe", 120, 320],
  ["dresser", 150, 360],
  ["bed-queen", 60, 60],
  ["nightstand", 110, 40],
  ["nightstand", 110, 100],
  ["desk", 170, 50],
  ["office-chair", 170, 95],
  ["bed-full", 262, 55],
  ["nightstand", 306, 40],
  ["dresser", 250, 118],
  ["bathtub", 252, 310],
  ["toilet", 310, 300],
  ["vanity-double", 268, 362],
];

const F2_ROOMS = [
  ["Bedroom 3", 0, 0, 216, 192],
  ["Primary suite", 0, 192, 216, 384],
  ["Ensuite bath", 0, 288, 96, 384],
  ["Walk-in closet", 96, 288, 192, 384],
  ["Bedroom 2", 216, 0, 336, 144],
  ["Stair hall", 216, 144, 336, 264],
  ["Full bath", 216, 264, 336, 384],
];

function buildLevelDesign(name, walls, openings, furniture, rooms, stairFloor) {
  let design = createEmptyDesign(name);
  design = buildWalls(design, walls);
  design = cutOpenings(design, openings);
  design = placeFurnishings(design, furniture);
  design = labelRooms(design, rooms);
  design = {
    ...design,
    annotations: [...design.annotations, ...stairAnnotations(stairFloor)],
  };
  return design;
}

/**
 * Build the "Maplewood Two-Story" seed document: a complete, valid
 * HomeProject envelope with two furnished levels — and deliberately NO
 * identity: no projectId, no owner/user fields, no createdAt/updatedAt,
 * no draft metadata. The fork handler POSTs a fresh project and PUTs this
 * document; the server assigns identity at that point.
 */
export function buildMaplewoodTwoStory() {
  resetDesignerIds();
  resetHomeProjectIds();
  resetSampleProjectIds();

  let project = createHomeProject(SAMPLE_NAME);
  const firstId = project.levels[0].id;
  project = updateLevelDesign(
    project,
    firstId,
    () =>
      buildLevelDesign(
        "First Floor",
        F1_WALLS,
        F1_OPENINGS,
        F1_FURNITURE,
        F1_ROOMS,
        1,
      ),
  );
  project = renameLevel(project, firstId, "First Floor");
  project = addLevel(project, "Second Floor");
  const secondId = project.levels[1].id;
  project = updateLevelDesign(
    project,
    secondId,
    () =>
      buildLevelDesign(
        "Second Floor",
        F2_WALLS,
        F2_OPENINGS,
        F2_FURNITURE,
        F2_ROOMS,
        2,
      ),
  );

  // Strip the envelope timestamps the domain functions stamp: a seed has
  // no history. (The PUT fork handler's parseHomeProject re-normalizes
  // them server-side at fork time.)
  const seed = { ...project };
  delete seed.createdAt;
  delete seed.updatedAt;
  return seed;
}

/** Sample gallery entries for the project list UI. */
export const SAMPLE_PROJECTS = Object.freeze([
  Object.freeze({
    seedId: SAMPLE_SEED_ID,
    name: SAMPLE_NAME,
    description:
      "An original modern two-story family home. The main floor has a living room, kitchen, dining room, foyer, powder room, and mudroom; upstairs holds a primary suite with ensuite and walk-in closet, two more bedrooms, and a full bath. Fork it to orbit the 3D view, check the elevations, and run the estimate.",
    levels: Object.freeze(["First Floor", "Second Floor"]),
    build: buildMaplewoodTwoStory,
  }),
]);
