// designSystems.js — named systems and object colors for pipes and
// equipment (pure, immutable).
//
// A system ("Cooling water", "Steam") has a name and a color; pipe runs and
// placed symbols (process equipment, valves, ...) may join one via
// `systemId`, and every member draws in the system color. Any member may
// also carry its own `color`, which wins over the system. Pipe runs may be
// flagged `underground`. Every field is optional: a design without them
// draws exactly as it always has, so no design-version bump.
//
//   design.systems: [{ id, name, color: "#rrggbb" }]
//   pipe / symbol:  { ..., systemId?, color?, underground? (pipes only) }

/** Starter colors offered when adding a system (nothing is pre-created). */
export const SYSTEM_PALETTE = Object.freeze([
  "#22c55e", // green
  "#ef4444", // red
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#a855f7", // purple
  "#14b8a6", // teal
  "#ec4899", // pink
  "#eab308", // yellow
  "#f97316", // orange
  "#94a3b8", // slate
]);

const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME_MAX = 60;
const MEMBER_LISTS = Object.freeze({ pipe: "pipes", symbol: "symbols" });

export function isSystemColor(value) {
  return typeof value === "string" && HEX.test(value);
}

function cleanColor(color) {
  if (!isSystemColor(color)) throw new Error(`Color must be #rrggbb, got "${color}".`);
  return color.toLowerCase();
}

function cleanName(name, systems, exceptId) {
  const s = String(name ?? "").trim();
  if (!s) throw new Error("A system needs a name.");
  if (s.length > NAME_MAX) throw new Error(`System name exceeds ${NAME_MAX} characters.`);
  if (systems.some((x) => x.id !== exceptId && x.name.toLowerCase() === s.toLowerCase())) {
    throw new Error(`A system named "${s}" already exists.`);
  }
  return s;
}

function nextSystemId(systems) {
  let n = 0;
  for (const s of systems) {
    const m = /^system_(\d+)$/.exec(s.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `system_${n + 1}`;
}

function systemsOf(design) {
  return Array.isArray(design.systems) ? design.systems : [];
}

function requireSystem(design, systemId) {
  const system = systemsOf(design).find((s) => s.id === systemId);
  if (!system) throw new Error(`Unknown system: ${systemId}`);
  return system;
}

function listKey(kind) {
  const key = MEMBER_LISTS[kind];
  if (!key) throw new Error(`Only a pipe or symbol can join a system (got "${kind}").`);
  return key;
}

function updateMember(design, { kind, id }, patch) {
  const key = listKey(kind);
  const list = design[key] || [];
  if (!list.some((m) => m.id === id)) throw new Error(`Unknown ${kind}: ${id}`);
  return { ...design, [key]: list.map((m) => (m.id === id ? patch(m) : m)) };
}

function withField(obj, field, value) {
  const next = { ...obj };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return next;
}

export function addSystem(design, { name, color, id } = {}) {
  const systems = systemsOf(design);
  const system = {
    id: id || nextSystemId(systems),
    name: cleanName(name, systems),
    color: cleanColor(color),
  };
  if (systems.some((s) => s.id === system.id)) throw new Error(`Duplicate system id: ${system.id}`);
  return { ...design, systems: [...systems, system] };
}

export function updateSystem(design, systemId, { name, color } = {}) {
  const systems = systemsOf(design);
  requireSystem(design, systemId);
  return {
    ...design,
    systems: systems.map((s) => {
      if (s.id !== systemId) return s;
      const next = { ...s };
      if (name !== undefined) next.name = cleanName(name, systems, systemId);
      if (color !== undefined) next.color = cleanColor(color);
      return next;
    }),
  };
}

/** Remove a system; its members stay, unassigned. */
export function deleteSystem(design, systemId) {
  requireSystem(design, systemId);
  const unassign = (list) => (list || []).map((m) => (m.systemId === systemId ? withField(m, "systemId", undefined) : m));
  return {
    ...design,
    systems: systemsOf(design).filter((s) => s.id !== systemId),
    pipes: unassign(design.pipes),
    symbols: unassign(design.symbols),
  };
}

/** Put a pipe run or symbol in a system (null takes it out). */
export function setMemberSystem(design, target, systemId) {
  if (systemId != null) requireSystem(design, systemId);
  return updateMember(design, target, (m) => withField(m, "systemId", systemId ?? undefined));
}

/** Give a pipe run or symbol its own color (null returns it to its system/default). */
export function setMemberColor(design, target, color) {
  const value = color == null ? undefined : cleanColor(color);
  return updateMember(design, target, (m) => withField(m, "color", value));
}

export function setPipeUnderground(design, pipeId, underground) {
  return updateMember(design, { kind: "pipe", id: pipeId }, (m) => withField(m, "underground", underground ? true : undefined));
}

/** Draw color for a member: its own color, else its system's, else `fallback`. */
export function effectiveColor(design, member, fallback) {
  if (isSystemColor(member?.color)) return member.color;
  if (member?.systemId) {
    const system = systemsOf(design).find((s) => s.id === member.systemId);
    if (system && isSystemColor(system.color)) return system.color;
  }
  return fallback;
}

/** Systems that have members, in system order: [{ id, name, color, count }]. */
export function systemLegend(design) {
  const counts = new Map();
  for (const m of [...(design.pipes || []), ...(design.symbols || [])]) {
    if (m.systemId) counts.set(m.systemId, (counts.get(m.systemId) || 0) + 1);
  }
  return systemsOf(design)
    .filter((s) => counts.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, color: s.color, count: counts.get(s.id) }));
}

/** Human-readable problems with systems and member colors (for validateDesign). */
export function systemErrors(design) {
  const errors = [];
  if (design.systems !== undefined && !Array.isArray(design.systems)) return ["Design systems must be a list."];
  const systems = systemsOf(design);
  const ids = new Set();
  const names = new Set();
  for (const s of systems) {
    if (ids.has(s.id)) errors.push(`Duplicate system id ${s.id}.`);
    ids.add(s.id);
    const key = String(s.name || "").toLowerCase();
    if (!key) errors.push(`System ${s.id} has no name.`);
    else if (names.has(key)) errors.push(`Duplicate system name "${s.name}".`);
    names.add(key);
    if (!isSystemColor(s.color)) errors.push(`System ${s.id} has a bad color "${s.color}".`);
  }
  for (const [kind, key] of Object.entries(MEMBER_LISTS)) {
    for (const m of design[key] || []) {
      if (m.systemId !== undefined && !ids.has(m.systemId)) {
        errors.push(`${kind === "pipe" ? "Pipe run" : "Symbol"} ${m.id} references unknown system ${m.systemId}.`);
      }
      if (m.color !== undefined && !isSystemColor(m.color)) {
        errors.push(`${kind === "pipe" ? "Pipe run" : "Symbol"} ${m.id} has a bad color "${m.color}".`);
      }
    }
  }
  return errors;
}
