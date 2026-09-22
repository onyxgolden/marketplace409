// Pure project model for FORGE Home Designer.
//
// Slice 1 (project foundation): one user-facing project wraps one or more
// room-designer documents as *levels*. The room designer geometry stays the
// canonical foundation; this module only adds the project envelope around it.
//
// A HomeProject is a plain JSON-serializable object:
//
//   {
//     version: 1,
//     name: "My house",
//     units: "in",                    // canonical geometry units for every level
//     levels: [{ id, name, design }], // design = room-designer document
//     currentLevelId: "level_1",
//     building: {                     // reference metadata only — never a
//       address: "", city: "",        // compliance determination
//       state: "", zip: "", notes: "",
//     },
//     createdAt: "2026-09-22T…Z",
//     updatedAt: "2026-09-22T…Z",
//   }
//
// Invariants (enforced by every mutator, checked by validateHomeProject):
// - levels is a non-empty array with unique ids
// - currentLevelId always resolves to a level
// - every level.design is a valid room-designer document
// - building holds plain strings only
//
// Every operation is pure: the input project is never mutated.

import {
  createEmptyDesign,
  DESIGN_VERSION,
  validateDesign,
} from "./designerDocument";

export const HOME_PROJECT_VERSION = 1;

export const DEFAULT_LEVEL_NAME = "Level 1";

const BUILDING_FIELDS = Object.freeze(["address", "city", "state", "zip", "notes"]);

let levelSequence = 0;
function nextLevelId() {
  levelSequence += 1;
  return `level_${levelSequence}`;
}
/** Test hook: restart level id generation so snapshots stay stable. */
export function resetHomeProjectIds() {
  levelSequence = 0;
}

function nowIso() {
  return new Date().toISOString();
}

function blankBuilding() {
  return { address: "", city: "", state: "", zip: "", notes: "" };
}

function normalizeBuilding(building) {
  const out = blankBuilding();
  if (building && typeof building === "object") {
    for (const field of BUILDING_FIELDS) {
      if (building[field] === undefined || building[field] === null) continue;
      if (typeof building[field] !== "string") {
        throw new Error(`building.${field} must be a string.`);
      }
      out[field] = building[field];
    }
  }
  return out;
}

function makeLevel(name, design, takenIds) {
  const problems = validateDesign(design);
  if (problems.length > 0) {
    throw new Error(`Level design is invalid: ${problems[0]}`);
  }
  // Level ids must stay unique even if the module counter was reset (e.g.
  // after a page reload + parseHomeProject). Skip ids already in use.
  let id = nextLevelId();
  while (takenIds && takenIds.has(id)) {
    id = nextLevelId();
  }
  return {
    id,
    name: String(name),
    design,
  };
}

function defaultLevelName(project) {
  return `Level ${project.levels.length + 1}`;
}

function touch(project, updates) {
  return { ...project, ...updates, updatedAt: nowIso() };
}

function assertProject(project) {
  if (!project || project.version !== HOME_PROJECT_VERSION) {
    throw new Error("Not a home project (bad version).");
  }
  if (!Array.isArray(project.levels) || project.levels.length === 0) {
    throw new Error("A home project must have at least one level.");
  }
  const ids = new Set();
  for (const level of project.levels) {
    if (!level || typeof level.id !== "string" || level.id === "") {
      throw new Error("Every level must have a non-empty string id.");
    }
    if (ids.has(level.id)) throw new Error(`Duplicate level id ${level.id}.`);
    ids.add(level.id);
    if (!level.design) throw new Error(`Level ${level.id} has no design.`);
  }
  if (!ids.has(project.currentLevelId)) {
    throw new Error("currentLevelId does not resolve to a level.");
  }
}

/**
 * Create a new project with a single empty level.
 * options: { levelName, units, building }
 */
export function createHomeProject(name, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const units = opts.units === undefined ? "in" : opts.units;
  if (typeof units !== "string" || units.trim() === "") {
    throw new Error("units must be a non-empty string.");
  }
  const levelName =
    typeof opts.levelName === "string" && opts.levelName.trim() !== ""
      ? opts.levelName
      : DEFAULT_LEVEL_NAME;
  const stamp = nowIso();
  const project = {
    version: HOME_PROJECT_VERSION,
    name: String(name || "Untitled project"),
    units,
    levels: [makeLevel(levelName, createEmptyDesign(levelName))],
    currentLevelId: null,
    building: normalizeBuilding(opts.building),
    createdAt: stamp,
    updatedAt: stamp,
  };
  project.currentLevelId = project.levels[0].id;
  return project;
}

/**
 * Wrap a legacy single-design document as a one-level project.
 * The current designer becomes "Level 1 Floor Plan".
 */
export function projectFromDesign(design, name) {
  const problems = validateDesign(design);
  if (problems.length > 0) {
    throw new Error(`Cannot wrap design as a project: ${problems[0]}`);
  }
  const projectName =
    typeof name === "string" && name.trim() !== "" ? name : design.name;
  const project = createHomeProject(projectName, { levelName: DEFAULT_LEVEL_NAME });
  const level = { ...project.levels[0], design };
  return touch(project, { levels: [level] });
}

/** Duck-type check used at load boundaries (legacy design vs project). */
export function isHomeProject(value) {
  return (
    !!value &&
    typeof value === "object" &&
    value.version === HOME_PROJECT_VERSION &&
    Array.isArray(value.levels)
  );
}

/**
 * Load-boundary helper: accept either a stored HomeProject or a legacy
 * single design document and always return a valid HomeProject.
 */
export function ensureHomeProject(value, name) {
  // Load-boundary leniency: a stored project with a null/missing design must
  // never crash the screen — open an empty project instead.
  if (value === null || value === undefined) {
    return createHomeProject(name);
  }
  if (isHomeProject(value)) {
    const problems = validateHomeProject(value);
    if (problems.length > 0) {
      throw new Error(`Stored project is invalid: ${problems[0]}`);
    }
    return value;
  }
  return projectFromDesign(value, name);
}

export function getLevel(project, levelId) {
  assertProject(project);
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) throw new Error(`Unknown level ${levelId}.`);
  return level;
}

export function getCurrentLevel(project) {
  assertProject(project);
  return getLevel(project, project.currentLevelId);
}

/** The room-designer document of the current level. */
export function getCurrentDesign(project) {
  return getCurrentLevel(project).design;
}

export function levelCount(project) {
  assertProject(project);
  return project.levels.length;
}

/** Add an empty level; the current level is unchanged. */
export function addLevel(project, name) {
  assertProject(project);
  const levelName =
    typeof name === "string" && name.trim() !== "" ? name : defaultLevelName(project);
  const takenIds = new Set(project.levels.map((l) => l.id));
  const level = makeLevel(levelName, createEmptyDesign(levelName), takenIds);
  return touch(project, { levels: [...project.levels, level] });
}

export function renameLevel(project, levelId, name) {
  assertProject(project);
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("Level name must be a non-empty string.");
  }
  getLevel(project, levelId); // throws on unknown id
  return touch(project, {
    levels: project.levels.map((l) => (l.id === levelId ? { ...l, name } : l)),
  });
}

/**
 * Remove a level. The last level cannot be removed. If the current level is
 * removed, the current level moves to the first remaining level.
 */
export function removeLevel(project, levelId) {
  assertProject(project);
  getLevel(project, levelId); // throws on unknown id
  if (project.levels.length === 1) {
    throw new Error("Cannot remove the last level of a project.");
  }
  const levels = project.levels.filter((l) => l.id !== levelId);
  const currentLevelId =
    project.currentLevelId === levelId ? levels[0].id : project.currentLevelId;
  return touch(project, { levels, currentLevelId });
}

export function setCurrentLevel(project, levelId) {
  assertProject(project);
  getLevel(project, levelId); // throws on unknown id
  if (project.currentLevelId === levelId) return project;
  return touch(project, { currentLevelId: levelId });
}

/**
 * Atomic level switch — the ONLY sanctioned path for moving currentLevelId
 * while the editor holds unsaved edits.
 *
 * The screen keeps two sources of truth: the HomeProject envelope and the
 * reducer's edited document. A switch must never read the "current" level
 * from one and the "current" design from the other and silently disagree
 * about which level is being edited. This function takes all three inputs
 * explicitly — the envelope, the design the editor is showing, and the
 * target id — and performs the order that matters:
 *
 *   1. validate the target level (a damaged target is refused, nothing moves)
 *   2. sync the editor's design back into the level being left
 *   3. move currentLevelId
 *
 * Returns { project, design }: the new envelope and the target level's
 * design, ready for LOAD_DESIGN. Throws on an unknown target id or a
 * damaged target design; a throw leaves the input project untouched.
 * Every operation is pure: the input project is never mutated.
 */
export function switchLevel(project, currentDesign, targetId) {
  assertProject(project);
  if (project.currentLevelId === targetId) {
    return { project, design: currentDesign };
  }
  const target = getLevel(project, targetId); // throws on unknown id
  const problems = validateDesign(target.design);
  if (problems.length > 0) {
    throw new Error(
      `Level "${target.name}" is damaged (${problems[0]}). It was not opened.`,
    );
  }
  const synced = updateLevelDesign(project, project.currentLevelId, () => currentDesign);
  const switched = setCurrentLevel(synced, targetId);
  return { project: switched, design: getCurrentDesign(switched) };
}

/**
 * Apply a room-designer document operation to one level's design.
 * updater receives the level's design and must return a valid design;
 * every other level is untouched.
 */
export function updateLevelDesign(project, levelId, updater) {
  assertProject(project);
  if (typeof updater !== "function") throw new Error("updater must be a function.");
  const level = getLevel(project, levelId); // throws on unknown id
  const nextDesign = updater(level.design);
  const problems = validateDesign(nextDesign);
  if (problems.length > 0) {
    throw new Error(`Updated level design is invalid: ${problems[0]}`);
  }
  return touch(project, {
    levels: project.levels.map((l) =>
      l.id === levelId ? { ...l, design: nextDesign } : l,
    ),
  });
}

/** Merge reference-only building metadata (address/city/state/zip/notes). */
export function updateBuildingMetadata(project, fields) {
  assertProject(project);
  if (!fields || typeof fields !== "object") {
    throw new Error("Building metadata must be an object.");
  }
  const building = { ...project.building };
  for (const field of BUILDING_FIELDS) {
    if (fields[field] === undefined) continue;
    if (typeof fields[field] !== "string") {
      throw new Error(`building.${field} must be a string.`);
    }
    building[field] = fields[field];
  }
  return touch(project, { building });
}

export function renameProject(project, name) {
  assertProject(project);
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("Project name must be a non-empty string.");
  }
  return touch(project, { name });
}

/** Structural validation; returns a list of human-readable problems. */
export function validateHomeProject(project) {
  try {
    assertProject(project);
  } catch (error) {
    return [error.message];
  }
  const errors = [];
  if (typeof project.name !== "string" || project.name.trim() === "") {
    errors.push("Project name must be a non-empty string.");
  }
  if (typeof project.units !== "string" || project.units.trim() === "") {
    errors.push("Project units must be a non-empty string.");
  }
  for (const level of project.levels) {
    if (typeof level.name !== "string" || level.name.trim() === "") {
      errors.push(`Level ${level.id} must have a non-empty name.`);
    }
    for (const problem of validateDesign(level.design)) {
      errors.push(`Level ${level.id}: ${problem}`);
    }
  }
  if (project.building && typeof project.building === "object") {
    for (const field of BUILDING_FIELDS) {
      const value = project.building[field];
      if (value !== undefined && typeof value !== "string") {
        errors.push(`building.${field} must be a string.`);
      }
    }
  }
  return errors;
}

export function serializeHomeProject(project) {
  assertProject(project);
  return JSON.stringify(project);
}

export function parseHomeProject(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Project is not valid JSON.");
  }
  assertProject(parsed);
  // Normalize optional envelope fields the way parseDesign normalizes
  // missing arrays: old/partial payloads load safely without a version bump.
  return {
    ...parsed,
    name: typeof parsed.name === "string" ? parsed.name : "Untitled project",
    units: typeof parsed.units === "string" && parsed.units ? parsed.units : "in",
    building: normalizeBuilding(parsed.building),
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso(),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
  };
}

// Re-exported so the project layer pins the document version it wraps.
export { DESIGN_VERSION };
