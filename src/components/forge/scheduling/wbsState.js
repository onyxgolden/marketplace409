// Pure, framework-agnostic state helpers for a project's Work Breakdown Structure -- a
// separate view of the same project (see WbsPage.jsx) for tracking activities in an
// outline, distinct from the lane-based Gantt chart (SchedulingBoard.jsx). The WBS itself
// lives on the board object (board.wbs = { nodes, activities }), so these helpers take and
// return the whole `board`, matching the pattern in schedulingBoardState.js -- every
// function here returns a new board object, never mutates the one it's given.
import { FIRST_TASK_NUMBER, TASK_NUMBER_STEP } from "./schedulingBoardState";

export const ACTIVITY_STATUSES = Object.freeze(["not_started", "in_progress", "complete"]);

// P6 itself doesn't hard-cap WBS depth, but an unbounded outline is easy to lose track of
// and hard to read once nested past a handful of levels -- 7 (depths 0-6) matches the
// deepest breakdowns commonly seen in practice while keeping the outline navigable.
export const MAX_WBS_DEPTH = 7;

export function defaultActivityDraft() {
  return { name: "", durationWeeks: 1, percentComplete: 0 };
}

export function wbsChildren(board, parentId = null) {
  return board.wbs.nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order);
}

export function activitiesForWbsNode(board, wbsId) {
  return board.wbs.activities.filter((activity) => activity.wbsId === wbsId).sort((a, b) => a.order - b.order);
}

// Builds a nested tree (each node gets a `children` array of nodes and an `activities`
// array) for rendering the outline -- a read-only projection, not part of the persisted
// shape, so callers never need to keep it in sync themselves.
export function wbsTree(board, parentId = null) {
  return wbsChildren(board, parentId).map((node) => Object.freeze({
    ...node,
    children: wbsTree(board, node.id),
    activities: activitiesForWbsNode(board, node.id),
  }));
}

function nextOrder(items, filterFn) {
  const siblings = items.filter(filterFn);
  return siblings.length ? Math.max(...siblings.map((item) => item.order)) + 1 : 0;
}

// -1 for the root ("no parent"), so a top-level node's own depth (parentDepth + 1) comes
// out to 0, matching depth being the number of ancestors above a node.
export function wbsNodeDepth(board, parentId) {
  if (parentId === null) return -1;
  const parent = board.wbs.nodes.find((n) => n.id === parentId);
  if (!parent) return -1;
  return wbsNodeDepth(board, parent.parentId) + 1;
}

// How many additional levels hang below this node already (0 for a leaf) -- needed when
// reparenting: moving a node with its own descendants can push those descendants past the
// depth limit even if the node itself would still be within it.
function subtreeHeight(board, nodeId) {
  const children = wbsChildren(board, nodeId);
  if (!children.length) return 0;
  return 1 + Math.max(...children.map((child) => subtreeHeight(board, child.id)));
}

// Mirrors how a P6-style WBS code is usually built: the next sibling number, dotted onto
// the parent's own code ("1", "1.1", "1.2", "2", ...). Just a sensible starting point --
// renameWbsNodeCode lets it be overwritten with anything.
function autoWbsCode(board, parentId) {
  const position = wbsChildren(board, parentId).length + 1;
  if (parentId === null) return String(position);
  const parent = board.wbs.nodes.find((n) => n.id === parentId);
  return `${parent?.code || "?"}.${position}`;
}

export function addWbsNode(board, { name, parentId = null }) {
  const trimmed = name?.trim();
  if (!trimmed) return board;
  if (wbsNodeDepth(board, parentId) + 1 >= MAX_WBS_DEPTH) return board;
  const node = Object.freeze({
    id: `wbs_${board.nextId}`, code: autoWbsCode(board, parentId), name: trimmed, parentId,
    order: nextOrder(board.wbs.nodes, (n) => n.parentId === parentId),
  });
  return Object.freeze({
    ...board, nextId: board.nextId + 1,
    wbs: Object.freeze({ ...board.wbs, nodes: Object.freeze([...board.wbs.nodes, node]) }),
  });
}

export function renameWbsNode(board, nodeId, name) {
  const trimmed = name?.trim();
  if (!trimmed) return board;
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      nodes: Object.freeze(board.wbs.nodes.map((node) => (node.id === nodeId ? Object.freeze({ ...node, name: trimmed }) : node))),
    }),
  });
}

// The WBS code is deliberately just a user-owned label, not derived from position in the
// tree -- no uniqueness or format is enforced, so it can be set to whatever numbering
// scheme (or non-numbering scheme) actually matches the project.
export function renameWbsNodeCode(board, nodeId, code) {
  const trimmed = code?.trim();
  if (!trimmed) return board;
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      nodes: Object.freeze(board.wbs.nodes.map((node) => (node.id === nodeId ? Object.freeze({ ...node, code: trimmed }) : node))),
    }),
  });
}

// Cascades to every descendant node (at any depth) and every activity assigned to any of
// them -- a WBS node standing alone with orphaned children or activities left pointing at
// a deleted parent would break the tree it's meant to represent.
export function deleteWbsNode(board, nodeId) {
  const doomed = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of board.wbs.nodes) {
      if (!doomed.has(node.id) && doomed.has(node.parentId)) { doomed.add(node.id); grew = true; }
    }
  }
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      nodes: Object.freeze(board.wbs.nodes.filter((node) => !doomed.has(node.id))),
      activities: Object.freeze(board.wbs.activities.filter((activity) => !doomed.has(activity.wbsId))),
    }),
  });
}

// Reparents a node under a new parent (or to the root with null) -- refuses to move a node
// under itself or under one of its own descendants (would disconnect that whole branch from
// the tree, a cycle with no path back to the root), and refuses a move that would push the
// node -- or the deepest of whatever descendants it's carrying with it -- past MAX_WBS_DEPTH.
export function moveWbsNode(board, nodeId, newParentId) {
  if (nodeId === newParentId) return board;
  const descendants = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of board.wbs.nodes) {
      if (node.id === nodeId || descendants.has(node.id)) continue;
      if (node.parentId === nodeId || descendants.has(node.parentId)) { descendants.add(node.id); grew = true; }
    }
  }
  if (newParentId !== null && descendants.has(newParentId)) return board;
  const newDepth = wbsNodeDepth(board, newParentId) + 1;
  if (newDepth + subtreeHeight(board, nodeId) >= MAX_WBS_DEPTH) return board;
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      nodes: Object.freeze(board.wbs.nodes.map((node) => (node.id === nodeId
        ? Object.freeze({ ...node, parentId: newParentId, order: nextOrder(board.wbs.nodes, (n) => n.parentId === newParentId) })
        : node))),
    }),
  });
}

// Swaps this node's order with the sibling immediately before/after it -- the simple
// up/down reordering the outline UI exposes, rather than free-form drag-and-drop.
export function reorderWbsNode(board, nodeId, direction) {
  const node = board.wbs.nodes.find((n) => n.id === nodeId);
  if (!node) return board;
  const siblings = wbsChildren(board, node.parentId);
  const index = siblings.findIndex((n) => n.id === nodeId);
  const swapWith = siblings[index + direction];
  if (!swapWith) return board;
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      nodes: Object.freeze(board.wbs.nodes.map((n) => {
        if (n.id === node.id) return Object.freeze({ ...n, order: swapWith.order });
        if (n.id === swapWith.id) return Object.freeze({ ...n, order: node.order });
        return n;
      })),
    }),
  });
}

export function addActivity(board, wbsId, { name, durationWeeks = 1 }) {
  const trimmed = name?.trim();
  if (!trimmed || !board.wbs.nodes.some((node) => node.id === wbsId)) return board;
  const nextTaskNumber = Number.isInteger(board.nextTaskNumber) ? board.nextTaskNumber : FIRST_TASK_NUMBER;
  const activity = Object.freeze({
    id: `activity_${board.nextId}`, code: `A${nextTaskNumber}`, wbsId, name: trimmed,
    durationWeeks: Math.max(1, durationWeeks || 1), percentComplete: 0,
    order: nextOrder(board.wbs.activities, (a) => a.wbsId === wbsId),
  });
  return Object.freeze({
    ...board, nextId: board.nextId + 1, nextTaskNumber: nextTaskNumber + TASK_NUMBER_STEP,
    wbs: Object.freeze({ ...board.wbs, activities: Object.freeze([...board.wbs.activities, activity]) }),
  });
}

export function updateActivity(board, activityId, patch) {
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      activities: Object.freeze(board.wbs.activities.map((activity) => {
        if (activity.id !== activityId) return activity;
        const next = { ...activity };
        if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
        if (patch.code !== undefined && patch.code.trim()) next.code = patch.code.trim();
        if (patch.durationWeeks !== undefined) next.durationWeeks = Math.max(1, Number(patch.durationWeeks) || 1);
        if (patch.percentComplete !== undefined) next.percentComplete = Math.max(0, Math.min(100, Number(patch.percentComplete) || 0));
        return Object.freeze(next);
      })),
    }),
  });
}

export function removeActivity(board, activityId) {
  return Object.freeze({
    ...board,
    wbs: Object.freeze({ ...board.wbs, activities: Object.freeze(board.wbs.activities.filter((activity) => activity.id !== activityId)) }),
  });
}

// Reassigns an activity to a different WBS node -- e.g. after realizing it belongs under a
// different phase of the breakdown.
export function moveActivity(board, activityId, newWbsId) {
  if (!board.wbs.nodes.some((node) => node.id === newWbsId)) return board;
  return Object.freeze({
    ...board,
    wbs: Object.freeze({
      ...board.wbs,
      activities: Object.freeze(board.wbs.activities.map((activity) => (activity.id === activityId
        ? Object.freeze({ ...activity, wbsId: newWbsId, order: nextOrder(board.wbs.activities, (a) => a.wbsId === newWbsId) })
        : activity))),
    }),
  });
}
