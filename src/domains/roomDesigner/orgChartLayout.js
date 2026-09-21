// Pure hierarchical layout for people org charts in the FORGE room designer.
//
// Input: person nodes [{ id, name, title, department, managerId }].
// Output: { positions: [{ id, x, y }], edges: [{ from, to }],
//           widthIn, heightIn }.
//
// x/y are the box's top-left corner in plan inches, relative to the chart
// anchor (the top-center of the laid-out tree). Layout is derived at render
// time — never stored on the document — so it can never go stale.
//
// The layout is deterministic: input order never affects the result because
// roots and children always sort by (name, id). Boxes never overlap: each
// subtree occupies a disjoint horizontal span, parents center over their
// children, and levels separate vertically by boxHeight + gapY.
//
// Corrupt references degrade gracefully instead of throwing or looping:
// unknown managers and self-references become roots, and reporting cycles
// are broken at the back-edge (everyone still gets placed).

export const ORG_CHART_METRICS = Object.freeze({
  boxWidthIn: 120, // person card width — chunky on purpose for TV readability
  boxHeightIn: 64,
  gapXIn: 28, // horizontal gap between neighboring boxes
  gapYIn: 84, // vertical gap between levels
});

const DEPARTMENT_ACCENTS = Object.freeze([
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#fb7185", // rose
]);

/** Deterministic accent color for a department label; slate when blank. */
export function departmentColor(department) {
  const s = String(department || "").trim().toLowerCase();
  if (!s) return "#64748b";
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return DEPARTMENT_ACCENTS[hash % DEPARTMENT_ACCENTS.length];
}

function sortKey(node) {
  return `${String(node.name || "").toLowerCase()}\0${node.id}`;
}

function compareNodes(a, b) {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * All ids reporting (transitively) under personId. Cycle-safe: a node is
 * never reported twice and personId itself is never included.
 */
export function descendantsOf(nodes, personId) {
  const byManager = new Map();
  for (const n of nodes || []) {
    if (!n || typeof n.id !== "string") continue;
    const m = n.managerId;
    if (m == null) continue;
    if (!byManager.has(m)) byManager.set(m, []);
    byManager.get(m).push(n.id);
  }
  const out = new Set();
  const stack = [personId];
  while (stack.length > 0) {
    const id = stack.pop();
    for (const child of byManager.get(id) || []) {
      if (child === personId || out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * True when assigning managerId as personId's manager would create a
 * reporting cycle (including self-management).
 */
export function wouldCreateCycle(nodes, personId, managerId) {
  if (managerId == null) return false;
  if (managerId === personId) return true;
  return descendantsOf(nodes, personId).has(managerId);
}

/**
 * Lay out a list of person nodes as a top-down tree.
 * Returns { positions, edges, widthIn, heightIn }.
 */
export function layoutOrgChart(nodes, metrics = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const boxW = metrics.boxWidthIn > 0 ? metrics.boxWidthIn : ORG_CHART_METRICS.boxWidthIn;
  const boxH = metrics.boxHeightIn > 0 ? metrics.boxHeightIn : ORG_CHART_METRICS.boxHeightIn;
  const gapX = metrics.gapXIn >= 0 ? metrics.gapXIn : ORG_CHART_METRICS.gapXIn;
  const gapY = metrics.gapYIn >= 0 ? metrics.gapYIn : ORG_CHART_METRICS.gapYIn;

  const byId = new Map();
  for (const n of list) {
    if (n && typeof n.id === "string") byId.set(n.id, n);
  }
  if (byId.size === 0) {
    return { positions: [], edges: [], widthIn: 0, heightIn: 0 };
  }

  const childrenOf = new Map();
  const roots = [];
  for (const node of byId.values()) {
    const m = node.managerId;
    if (m == null || m === node.id || !byId.has(m)) {
      roots.push(node); // unknown/self manager degrades to a root
    } else {
      if (!childrenOf.has(m)) childrenOf.set(m, []);
      childrenOf.get(m).push(node);
    }
  }
  for (const kids of childrenOf.values()) kids.sort(compareNodes);
  roots.sort(compareNodes);

  // pos: id -> { x } (box left edge, cursor coords); y derives from depth.
  const pos = new Map();
  const visited = new Set();
  let cursor = 0;
  let maxDepth = 0;

  function place(node, depth) {
    if (visited.has(node.id)) return; // cycle back-edge: already placed
    visited.add(node.id);
    if (depth > maxDepth) maxDepth = depth;
    const kids = (childrenOf.get(node.id) || []).filter((k) => !visited.has(k.id));
    if (kids.length === 0) {
      pos.set(node.id, { x: cursor, y: depth * (boxH + gapY) });
      cursor += boxW + gapX;
      return;
    }
    for (const kid of kids) place(kid, depth + 1);
    const placed = kids.filter((k) => pos.has(k.id));
    if (placed.length === 0) {
      // Every child was a cycle back-edge; fall back to a leaf slot.
      pos.set(node.id, { x: cursor, y: depth * (boxH + gapY) });
      cursor += boxW + gapX;
      return;
    }
    const firstX = pos.get(placed[0].id).x;
    const lastX = pos.get(placed[placed.length - 1].id).x;
    const centerX = (firstX + lastX) / 2 + boxW / 2;
    pos.set(node.id, { x: centerX - boxW / 2, y: depth * (boxH + gapY) });
  }

  for (const root of roots) place(root, 0);
  // Cycle members unreachable from any root become extra roots (sorted, so
  // the result stays deterministic) — nobody is ever dropped.
  const leftovers = [...byId.values()].filter((n) => !visited.has(n.id)).sort(compareNodes);
  for (const node of leftovers) place(node, 0);

  const totalWidth = cursor > 0 ? cursor - gapX : 0;
  const shift = totalWidth / 2; // center the tree on the anchor's x
  const ordered = [...byId.values()].sort(compareNodes);
  return {
    positions: ordered.map((n) => {
      const p = pos.get(n.id);
      return { id: n.id, x: p.x - shift, y: p.y };
    }),
    edges: ordered.flatMap((n) => {
      const m = n.managerId;
      if (m == null || m === n.id || !byId.has(m) || !pos.has(m)) return [];
      return [{ from: m, to: n.id }];
    }),
    widthIn: totalWidth,
    heightIn: (maxDepth + 1) * boxH + maxDepth * gapY,
  };
}
