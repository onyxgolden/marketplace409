// FORGE Chart Builder — deterministic layout engine (slice 2).
// Pure functions: no DOM, no React, no randomness. Every ordering tie is
// broken by node id sort order, so the same document always produces the
// same coordinates. Positions are top-left { x, y } in canvas pixels.
//
// Algorithms (named by the slice-1 template layoutPreset values):
//   tidy-tree       — Reingold–Tilford-style tidy tree for org forests;
//                     multiple roots laid out side by side.
//   column-group    — org forest grouped into department columns.
//   compact-grid    — row-major grid (compact TV board).
//   layered         — longest-path rank layout for workflows; feedback edges
//                     (edges that point backwards in rank) still get finite
//                     deterministic ranks.
//   swimlane        — layered layout grouped into department lanes.
//   binary-tree     — tidy tree tuned for decision trees.
//   kanban-columns  — rank columns with kanban spacing.

export const LAYOUT_NODE_ORG = Object.freeze({ w: 176, h: 76 });
export const LAYOUT_NODE_WORKFLOW = Object.freeze({ w: 168, h: 72 });

export const DEFAULT_LAYOUT_GAPS = Object.freeze({
  siblingGap: 24,
  levelGap: 72,
  layerGap: 80,
  columnGap: 64,
  laneGap: 48,
  forestGap: 96,
  maxColumns: 6,
});

function sortedIds(ids) {
  return [...ids].sort();
}

function isSupervisorEdge(edge) {
  return edge.type === "supervisor" || edge.type === "";
}

function departmentOf(node) {
  const dept = node?.fields?.department;
  return typeof dept === "string" ? dept.trim() : "";
}

// Child adjacency. For org documents only supervisor edges count; workflow
// documents use every edge.
function childMap(doc) {
  const map = new Map();
  for (const node of doc.nodes) map.set(node.id, []);
  for (const edge of doc.edges) {
    if (doc.type === "org" && !isSupervisorEdge(edge)) continue;
    if (map.has(edge.from) && map.has(edge.to)) {
      map.get(edge.from).push(edge.to);
    }
  }
  for (const [key, value] of map) map.set(key, sortedIds(value));
  return map;
}

function orgRoots(doc) {
  const hasIncoming = new Set();
  for (const edge of doc.edges) {
    if (!isSupervisorEdge(edge)) continue;
    hasIncoming.add(edge.to);
  }
  return sortedIds(
    doc.nodes.map((n) => n.id).filter((id) => !hasIncoming.has(id))
  );
}

// ---------------------------------------------------------------------------
// Tidy tree (org forests; also backs binary-tree and department columns).
// ---------------------------------------------------------------------------

function placeSubtree(children, positions, placed, id, depth, cursor, slotW, nodeW, rowH) {
  // `placed` guards against cycles (workflow feedback edges): a node is
  // laid out once, at its first visit, so layout always terminates.
  if (placed.has(id)) return cursor;
  placed.add(id);
  const kids = (children.get(id) ?? []).filter((kid) => !placed.has(kid));
  if (kids.length === 0) {
    const centerX = cursor + slotW / 2;
    positions[id] = { x: centerX - nodeW / 2, y: depth * rowH };
    return cursor + slotW;
  }
  let next = cursor;
  for (const kid of kids) {
    next = placeSubtree(children, positions, placed, kid, depth + 1, next, slotW, nodeW, rowH);
  }
  const centers = kids.map((kid) => positions[kid].x + nodeW / 2);
  const centerX = centers.reduce((a, b) => a + b, 0) / centers.length;
  positions[id] = { x: centerX - nodeW / 2, y: depth * rowH };
  return next;
}

function layoutTidyForest(children, roots, { nodeW, nodeH, siblingGap, levelGap, forestGap }) {
  const positions = {};
  const placed = new Set();
  const slotW = nodeW + siblingGap;
  const rowH = nodeH + levelGap;
  let cursor = 0;
  for (const root of roots) {
    cursor = placeSubtree(children, positions, placed, root, 0, cursor, slotW, nodeW, rowH);
    cursor += forestGap;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Column-group: department columns of tidy trees.
// ---------------------------------------------------------------------------

function layoutColumnGroup(doc, opts) {
  const children = childMap(doc);
  const groups = new Map();
  for (const node of doc.nodes) {
    const key = departmentOf(node);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node.id);
  }
  // Named departments alphabetically; the unassigned column goes last.
  const keys = [...groups.keys()].sort(
    (a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
  );
  const positions = {};
  let xCursor = 0;
  for (const key of keys) {
    const memberIds = new Set(groups.get(key));
    // Roots restricted to this column: members with no incoming supervisor
    // edge from another member.
    const incomingFromMember = new Set();
    for (const edge of doc.edges) {
      if (!isSupervisorEdge(edge)) continue;
      if (memberIds.has(edge.from) && memberIds.has(edge.to)) {
        incomingFromMember.add(edge.to);
      }
    }
    const roots = sortedIds([...memberIds].filter((id) => !incomingFromMember.has(id)));
    // Children restricted to the column so trees never cross columns.
    const colChildren = new Map();
    for (const id of memberIds) {
      colChildren.set(
        id,
        (children.get(id) ?? []).filter((kid) => memberIds.has(kid))
      );
    }
    const sub = layoutTidyForest(colChildren, roots, opts);
    let maxRight = 0;
    for (const [id, pos] of Object.entries(sub)) {
      positions[id] = { x: pos.x + xCursor, y: pos.y };
      maxRight = Math.max(maxRight, pos.x + opts.nodeW);
    }
    xCursor += maxRight + opts.columnGap;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Compact grid.
// ---------------------------------------------------------------------------

function layoutCompactGrid(doc, { nodeW, nodeH, siblingGap, levelGap, maxColumns }) {
  const ids = sortedIds(doc.nodes.map((n) => n.id));
  const cols = Math.max(1, maxColumns ?? DEFAULT_LAYOUT_GAPS.maxColumns);
  const positions = {};
  ids.forEach((id, index) => {
    positions[id] = {
      x: (index % cols) * (nodeW + siblingGap),
      y: Math.floor(index / cols) * (nodeH + levelGap),
    };
  });
  return positions;
}

// ---------------------------------------------------------------------------
// Layered / ranked layout for workflows (cycles allowed).
// ---------------------------------------------------------------------------

// Strongly connected components (Tarjan), deterministic: adjacency and the
// visit order are id-sorted, so the same document yields the same components.
function stronglyConnectedComponents(doc) {
  const ids = sortedIds(doc.nodes.map((n) => n.id));
  const adj = new Map(ids.map((id) => [id, []]));
  for (const edge of doc.edges) {
    if (adj.has(edge.from) && adj.has(edge.to) && edge.from !== edge.to) {
      adj.get(edge.from).push(edge.to);
    }
  }
  for (const id of ids) adj.set(id, sortedIds(adj.get(id)));

  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  function strongconnect(v) {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v)) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(sortedIds(component));
    }
  }

  for (const v of ids) {
    if (!index.has(v)) strongconnect(v);
  }
  return components;
}

// Longest-path ranks over the SCC condensation DAG: cycles collapse into a
// single rank, so feedback edges always get finite, deterministic ranks and
// nodes in the same feedback loop share a rank.
function longestPathRanks(doc) {
  const components = stronglyConnectedComponents(doc);
  const compOf = new Map();
  components.forEach((component, i) => {
    for (const id of component) compOf.set(id, i);
  });

  const seen = new Set();
  const dagEdges = [];
  for (const edge of doc.edges) {
    const a = compOf.get(edge.from);
    const b = compOf.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}>${b}`;
    if (!seen.has(key)) {
      seen.add(key);
      dagEdges.push([a, b]);
    }
  }

  const out = components.map(() => []);
  const indeg = new Array(components.length).fill(0);
  for (const [a, b] of dagEdges) {
    out[a].push(b);
    indeg[b]++;
  }

  const rank = new Array(components.length).fill(0);
  const queue = [];
  for (let i = 0; i < components.length; i++) {
    if (indeg[i] === 0) queue.push(i);
  }
  queue.sort((a, b) => a - b);
  while (queue.length > 0) {
    const a = queue.shift();
    for (const b of out[a].sort((x, y) => x - y)) {
      if (rank[a] + 1 > rank[b]) rank[b] = rank[a] + 1;
      indeg[b]--;
      if (indeg[b] === 0) {
        queue.push(b);
        queue.sort((x, y) => x - y);
      }
    }
  }

  const nodeRank = new Map();
  components.forEach((component, i) => {
    for (const id of component) nodeRank.set(id, rank[i]);
  });
  return nodeRank;
}

function layoutLayered(doc, { nodeW, nodeH, siblingGap, layerGap }) {
  const rank = longestPathRanks(doc);
  const byRank = new Map();
  for (const [id, r] of rank) {
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(id);
  }
  const positions = {};
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const ids = sortedIds(byRank.get(r));
    ids.forEach((id, index) => {
      positions[id] = {
        x: r * (nodeW + layerGap),
        y: index * (nodeH + siblingGap),
      };
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Swimlane: layered layout grouped into department lanes.
// ---------------------------------------------------------------------------

function layoutSwimlane(doc, { nodeW, nodeH, siblingGap, layerGap, laneGap }) {
  const rank = longestPathRanks(doc);
  const lanes = new Map();
  for (const node of doc.nodes) {
    const key = departmentOf(node) || "General";
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(node.id);
  }
  const keys = [...lanes.keys()].sort((a, b) => a.localeCompare(b));
  const positions = {};
  let yCursor = 0;
  for (const key of keys) {
    const byRank = new Map();
    for (const id of lanes.get(key)) {
      const r = rank.get(id);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(id);
    }
    let laneBottom = yCursor;
    for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
      const ids = sortedIds(byRank.get(r));
      ids.forEach((id, index) => {
        positions[id] = {
          x: r * (nodeW + layerGap),
          y: yCursor + index * (nodeH + siblingGap),
        };
        laneBottom = Math.max(laneBottom, positions[id].y + nodeH);
      });
    }
    // Stack lanes below the actual placements so rank gaps can't overlap.
    yCursor = laneBottom + laneGap;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

function swapAxes(positions) {
  const out = {};
  for (const [id, pos] of Object.entries(positions)) {
    out[id] = { x: pos.y, y: pos.x };
  }
  return out;
}

// layoutChart(doc, template?) -> { [nodeId]: { x, y } }.
// template may be null (e.g. an imported document): fall back to the
// algorithm that matches the document type.
export function layoutChart(doc, template) {
  if (!doc || !Array.isArray(doc.nodes)) {
    throw new Error("layoutChart requires a ChartDocument");
  }
  const preset = template?.layoutPreset ?? {};
  const isOrg = doc.type === "org";
  const size = isOrg ? LAYOUT_NODE_ORG : LAYOUT_NODE_WORKFLOW;
  const opts = {
    nodeW: size.w,
    nodeH: size.h,
    siblingGap: preset.siblingGap ?? DEFAULT_LAYOUT_GAPS.siblingGap,
    levelGap: preset.levelGap ?? DEFAULT_LAYOUT_GAPS.levelGap,
    layerGap: preset.layerGap ?? DEFAULT_LAYOUT_GAPS.layerGap,
    columnGap: preset.columnGap ?? DEFAULT_LAYOUT_GAPS.columnGap,
    laneGap: preset.laneGap ?? DEFAULT_LAYOUT_GAPS.laneGap,
    forestGap: DEFAULT_LAYOUT_GAPS.forestGap,
    maxColumns: preset.maxColumns ?? DEFAULT_LAYOUT_GAPS.maxColumns,
  };
  const direction = preset.direction ?? (isOrg ? "top-down" : "left-right");

  switch (preset.algorithm) {
    case "column-group":
      return layoutColumnGroup(doc, opts);
    case "compact-grid":
      return layoutCompactGrid(doc, opts);
    case "swimlane":
      return layoutSwimlane(doc, opts);
    case "kanban-columns":
      return layoutLayered(doc, { ...opts, layerGap: opts.columnGap });
    case "binary-tree":
    case "tidy-tree":
      return direction === "left-right"
        ? swapAxes(layoutTidyForest(childMap(doc), orgRoots(doc), opts))
        : layoutTidyForest(childMap(doc), orgRoots(doc), opts);
    case "layered":
      return direction === "top-down"
        ? swapAxes(layoutLayered(doc, opts))
        : layoutLayered(doc, opts);
    default:
      return isOrg
        ? layoutTidyForest(childMap(doc), orgRoots(doc), opts)
        : layoutLayered(doc, opts);
  }
}

// Bounding box of laid-out nodes: { x, y, w, h }.
export function contentBounds(positions, nodeSize) {
  const entries = Object.values(positions);
  if (entries.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const w = nodeSize?.w ?? LAYOUT_NODE_ORG.w;
  const h = nodeSize?.h ?? LAYOUT_NODE_ORG.h;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pos of entries) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w);
    maxY = Math.max(maxY, pos.y + h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
