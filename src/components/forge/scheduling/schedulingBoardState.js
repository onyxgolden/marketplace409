// Pure, framework-agnostic state helpers for the scheduling wall-board.
// Ported from docs/scheduling/prototype.html, made immutable per FORGE_CONSTITUTION.md
// Rule 6 (the prototype mutated `state` directly; every helper here returns a new object).
// This is local-component-state only for now — no Supabase reads/writes (see SPEC.md phase 2).

export const CATEGORY_COLORS = Object.freeze({
  gov: "#7c5cff", eng: "#0fa38f", proc: "#dd9a2e", field: "#2f6fed", shut: "#e0483f",
});
export const CATEGORY_NAMES = Object.freeze({
  gov: "Project Governance", eng: "Project Engineering", proc: "Procurement",
  field: "Field Execution", shut: "Shutdown & Startup",
});
export const MILESTONE_COLOR = "#f0b429";

export const DEFAULT_CHIPS = Object.freeze([
  { label: "Kickoff", category: "gov", durationWeeks: 0, milestone: true },
  { label: "Charter Approval", category: "gov", durationWeeks: 1, milestone: false },
  { label: "Stage Gate Review", category: "gov", durationWeeks: 1, milestone: false },
  { label: "Investment / Funding Approval", category: "gov", durationWeeks: 0, milestone: true },
  { label: "Steering Committee Review", category: "gov", durationWeeks: 1, milestone: false },
  { label: "Management of Change (MOC)", category: "gov", durationWeeks: 2, milestone: false },
  { label: "Conceptual Design", category: "eng", durationWeeks: 4, milestone: false },
  { label: "Feasibility / FEED", category: "eng", durationWeeks: 6, milestone: false },
  { label: "Detailed Design", category: "eng", durationWeeks: 8, milestone: false },
  { label: "Civil Engineering", category: "eng", durationWeeks: 5, milestone: false },
  { label: "Mechanical Engineering", category: "eng", durationWeeks: 5, milestone: false },
  { label: "Electrical Engineering", category: "eng", durationWeeks: 5, milestone: false },
  { label: "Instrumentation Engineering", category: "eng", durationWeeks: 5, milestone: false },
  { label: "Process Engineering", category: "eng", durationWeeks: 5, milestone: false },
  { label: "RFQ Issued", category: "proc", durationWeeks: 0, milestone: true },
  { label: "Bid Evaluation", category: "proc", durationWeeks: 3, milestone: false },
  { label: "PO Issued", category: "proc", durationWeeks: 0, milestone: true },
  { label: "Long-Lead Equipment Fabrication", category: "proc", durationWeeks: 12, milestone: false },
  { label: "Vendor Data Review", category: "proc", durationWeeks: 4, milestone: false },
  { label: "Equipment Delivery", category: "proc", durationWeeks: 0, milestone: true },
  { label: "Site Mobilization", category: "field", durationWeeks: 0, milestone: true },
  { label: "Civil / Foundations", category: "field", durationWeeks: 4, milestone: false },
  { label: "Structural Steel", category: "field", durationWeeks: 5, milestone: false },
  { label: "Piping Install", category: "field", durationWeeks: 6, milestone: false },
  { label: "Electrical Install", category: "field", durationWeeks: 5, milestone: false },
  { label: "Instrumentation Install", category: "field", durationWeeks: 4, milestone: false },
  { label: "Mechanical Install", category: "field", durationWeeks: 5, milestone: false },
  { label: "Insulation & Paint", category: "field", durationWeeks: 3, milestone: false },
  { label: "Turnaround Window", category: "shut", durationWeeks: 3, milestone: false },
  { label: "Pre-Job Safety Walkdown", category: "shut", durationWeeks: 1, milestone: false },
  { label: "Commissioning", category: "shut", durationWeeks: 3, milestone: false },
  { label: "Startup", category: "shut", durationWeeks: 2, milestone: false },
  { label: "Pre-Startup Safety Review (PSSR)", category: "shut", durationWeeks: 0, milestone: true },
  { label: "Return to Service", category: "shut", durationWeeks: 0, milestone: true },
]);

export const DEFAULT_LANES = Object.freeze([
  { id: "lane_ms", name: "Milestones" },
  { id: "lane_gov", name: "Governance" },
  { id: "lane_eng", name: "Engineering" },
  { id: "lane_proc", name: "Procurement" },
  { id: "lane_field1", name: "Field Execution" },
  { id: "lane_field2", name: "Field Execution (cont.)" },
  { id: "lane_shut", name: "Shutdown & Startup" },
].map((lane) => Object.freeze({ ...lane })));

export const ROW_HEIGHT_PX = 46;
export const LANE_LABEL_WIDTH_PX = 170;
export const MIN_ZOOM_PX = 50;
export const MAX_ZOOM_PX = 160;

export const BASE_BLOCK_FONT_SIZE_PX = 11.5;
export const MIN_BLOCK_FONT_SIZE_PX = 8;
const AVG_CHAR_WIDTH_RATIO = 0.58; // rough glyph width as a fraction of font-size, for bold sans-serif
const LINE_HEIGHT_RATIO = 1.2;

// How large a bar's label can render before it needs to shrink to fit, given the bar's
// own box. Without real text measurement (no DOM in the pure-state layer), this estimates
// character capacity from width/height at the base size and scales the font down toward
// MIN_BLOCK_FONT_SIZE_PX -- never below it. If even the floor size wouldn't fit, this still
// returns the floor; the component lets the label overflow the bar visually rather than
// clip it, per the "never smaller than 8, let it overrun instead" requirement.
// `baseFontSizePx` is the user's preferred size (from the text toolbar's size dropdown,
// per-block) -- shrinking still starts from there and floors at MIN_BLOCK_FONT_SIZE_PX.
export function fitBlockFontSizePx(label, widthPx, heightPx = ROW_HEIGHT_PX - 10, baseFontSizePx = BASE_BLOCK_FONT_SIZE_PX) {
  const text = (label || "").trim();
  const base = Number.isFinite(baseFontSizePx) && baseFontSizePx > 0 ? baseFontSizePx : BASE_BLOCK_FONT_SIZE_PX;
  if (!text || widthPx <= 0 || heightPx <= 0) return base;
  const maxLines = Math.max(1, Math.floor(heightPx / (base * LINE_HEIGHT_RATIO)));
  const charsPerLineAtBase = Math.max(1, Math.floor(widthPx / (base * AVG_CHAR_WIDTH_RATIO)));
  const budgetAtBase = charsPerLineAtBase * maxLines;
  if (text.length <= budgetAtBase) return base;
  const scale = Math.sqrt(budgetAtBase / text.length);
  return Math.max(MIN_BLOCK_FONT_SIZE_PX, Math.min(base, base * scale));
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function colorForCategory(category) {
  return CATEGORY_COLORS[category] || "#999999";
}

export const FIRST_TASK_NUMBER = 1010;
export const TASK_NUMBER_STEP = 10;

export function defaultBoardState() {
  return Object.freeze({
    projectName: "New Project",
    startDate: todayISO(0),
    endDate: todayISO(364),
    weekWidth: 90,
    lanes: DEFAULT_LANES,
    blocks: Object.freeze([]),
    dependencies: Object.freeze([]),
    customChips: Object.freeze([]),
    nextId: 1,
    nextTaskNumber: FIRST_TASK_NUMBER,
  });
}

function parseISODate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Returns an array of ISO date strings, one per week column, matching the prototype's
// week-based grid exactly (weekly columns from startDate through endDate inclusive).
export function computeWeeks(startDate, endDate) {
  const weeks = [];
  let cursor = parseISODate(startDate);
  const end = parseISODate(endDate);
  let guard = 0;
  while (cursor <= end && guard < 400) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
    guard += 1;
  }
  return weeks.length ? weeks : [startDate];
}

export function clampIndex(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pixelToIndex(px, cellSize) {
  return Math.floor(px / cellSize);
}

// Every week index a block occupies: a task spans [startIdx, startIdx+duration), a
// milestone occupies just its own week. Backs "hide empty weeks" -- a week with nothing
// in it, in any lane, is a candidate to collapse out of the timeline.
export function occupiedWeekIndices(state) {
  const occupied = new Set();
  for (const block of state.blocks) {
    const span = block.milestone ? 1 : Math.max(1, block.duration);
    for (let i = 0; i < span; i += 1) occupied.add(block.startIdx + i);
  }
  return occupied;
}

// Indices into a `weeksLength`-long week array that have at least one block occupying
// them, in ascending order. Rendering only these columns compresses out empty gaps
// without touching any block's actual startIdx -- it's a view concern, not a data edit.
export function visibleWeekIndices(state, weeksLength) {
  const occupied = occupiedWeekIndices(state);
  const indices = [];
  for (let i = 0; i < weeksLength; i += 1) if (occupied.has(i)) indices.push(i);
  return Object.freeze(indices);
}

// weekWidth (clamped to at least minWeekPx) so `columnCount` week columns fit exactly
// within availableWidthPx -- what "Fit to project" uses to zoom out to the whole timeline.
export function fitWeekWidthPx(availableWidthPx, columnCount, minWeekPx = 1) {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0 || !Number.isFinite(columnCount) || columnCount <= 0) {
    return minWeekPx;
  }
  return Math.max(minWeekPx, Math.floor(availableWidthPx / columnCount));
}

function allChips(state) {
  return [...DEFAULT_CHIPS, ...state.customChips];
}
export function chipsByCategory(state) {
  const grouped = {};
  for (const category of Object.keys(CATEGORY_NAMES)) grouped[category] = [];
  for (const chip of allChips(state)) {
    if (grouped[chip.category]) grouped[chip.category].push(chip);
  }
  return grouped;
}

export function laneIndexOf(state, laneId) {
  return state.lanes.findIndex((lane) => lane.id === laneId);
}

export function addBlock(state, chip, weekIdx, laneIdx) {
  const lane = state.lanes[clampIndex(laneIdx, 0, state.lanes.length - 1)];
  if (!lane) return state;
  const block = Object.freeze({
    id: `b${state.nextId}`,
    // Immutable once assigned, never reused (matches SPEC.md §2.4 task_code) — the counter
    // only ever increases, even across deletes, so a code is never handed out twice.
    taskCode: `A${state.nextTaskNumber}`,
    label: chip.label,
    category: chip.category,
    milestone: !!chip.milestone,
    duration: chip.milestone ? 0 : Math.max(1, chip.durationWeeks || 1),
    startIdx: Math.max(0, weekIdx),
    laneId: lane.id,
    // Text toolbar overrides -- null/true means "use the default", not "unset".
    fontSize: chip.fontSize ?? null,
    textColor: chip.textColor ?? null,
    bold: chip.bold ?? true,
  });
  return Object.freeze({
    ...state, nextId: state.nextId + 1, nextTaskNumber: state.nextTaskNumber + TASK_NUMBER_STEP,
    blocks: Object.freeze([...state.blocks, block]),
  });
}

export function moveBlock(state, blockId, weekIdx, laneIdx) {
  const lane = state.lanes[clampIndex(laneIdx, 0, state.lanes.length - 1)];
  if (!lane) return state;
  const nextWeekIdx = Math.max(0, weekIdx);
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) =>
      block.id === blockId ? Object.freeze({ ...block, startIdx: nextWeekIdx, laneId: lane.id }) : block)),
  });
}

// Shifts every listed block by the SAME week/lane delta, so a multi-selected group keeps
// its relative spacing when dragged together (as opposed to moveBlock's per-block absolute
// target, which would need each block's own destination computed and could desync a group).
export function moveBlocksBy(state, blockIds, weekDelta, laneDelta) {
  const idSet = new Set(blockIds);
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) => {
      if (!idSet.has(block.id)) return block;
      const nextLaneIdx = clampIndex(laneIndexOf(state, block.laneId) + laneDelta, 0, state.lanes.length - 1);
      return Object.freeze({ ...block, startIdx: Math.max(0, block.startIdx + weekDelta), laneId: state.lanes[nextLaneIdx].id });
    })),
  });
}

export function resizeBlock(state, blockId, duration) {
  const nextDuration = Math.max(1, duration);
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) =>
      block.id === blockId && !block.milestone ? Object.freeze({ ...block, duration: nextDuration }) : block)),
  });
}

// Resizing from the left edge: the finish week (startIdx + duration) stays fixed, and
// startIdx moves to `newStartIdx` -- clamped to [0, finish - 1] so duration never drops
// below 1 and the block never starts before the project's first week.
export function resizeBlockFromStart(state, blockId, newStartIdx) {
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) => {
      if (block.id !== blockId || block.milestone) return block;
      const finishIdx = block.startIdx + block.duration;
      const nextStartIdx = Math.max(0, Math.min(newStartIdx, finishIdx - 1));
      return Object.freeze({ ...block, startIdx: nextStartIdx, duration: finishIdx - nextStartIdx });
    })),
  });
}

export function renameBlock(state, blockId, label) {
  const trimmed = label?.trim();
  if (!trimmed) return state;
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) =>
      block.id === blockId ? Object.freeze({ ...block, label: trimmed }) : block)),
  });
}

function removeDependenciesTouching(dependencies, blockIds) {
  const idSet = new Set(blockIds);
  return dependencies.filter((dependency) => !idSet.has(dependency.predecessorId) && !idSet.has(dependency.successorId));
}

export function removeBlock(state, blockId) {
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.filter((block) => block.id !== blockId)),
    dependencies: Object.freeze(removeDependenciesTouching(state.dependencies, [blockId])),
  });
}

// `index` inserts before that position (0 = new first lane); omitted appends at the end.
export function addLane(state, name, index) {
  const trimmed = name?.trim();
  if (!trimmed) return state;
  const lane = Object.freeze({ id: `lane_${state.nextId}`, name: trimmed });
  const insertAt = Number.isInteger(index) ? clampIndex(index, 0, state.lanes.length) : state.lanes.length;
  const lanes = [...state.lanes];
  lanes.splice(insertAt, 0, lane);
  return Object.freeze({ ...state, nextId: state.nextId + 1, lanes: Object.freeze(lanes) });
}

export function renameLane(state, laneId, name) {
  const trimmed = name?.trim();
  if (!trimmed) return state;
  return Object.freeze({
    ...state,
    lanes: Object.freeze(state.lanes.map((lane) => (lane.id === laneId ? Object.freeze({ ...lane, name: trimmed }) : lane))),
  });
}

export function deleteLane(state, laneId) {
  const removedBlockIds = state.blocks.filter((block) => block.laneId === laneId).map((block) => block.id);
  return Object.freeze({
    ...state,
    lanes: Object.freeze(state.lanes.filter((lane) => lane.id !== laneId)),
    blocks: Object.freeze(state.blocks.filter((block) => block.laneId !== laneId)),
    dependencies: Object.freeze(removeDependenciesTouching(state.dependencies, removedBlockIds)),
  });
}

export function addCustomChip(state, { label, category, durationWeeks, milestone }) {
  const trimmed = label?.trim();
  if (!trimmed || !CATEGORY_NAMES[category]) return state;
  const chip = Object.freeze({
    label: trimmed, category, milestone: !!milestone,
    durationWeeks: milestone ? 0 : Math.max(1, durationWeeks || 1),
  });
  return Object.freeze({ ...state, customChips: Object.freeze([...state.customChips, chip]) });
}

export function setProjectDates(state, startDate, endDate) {
  if (!startDate || !endDate || parseISODate(endDate) <= parseISODate(startDate)) return state;
  return Object.freeze({ ...state, startDate, endDate });
}

export const RELATIONSHIP_TYPES = Object.freeze(["FS", "SS", "FF", "SF"]);

// predecessorId finishes/starts before successorId starts/finishes, per relationshipType.
export function addDependency(state, predecessorId, successorId, relationshipType = "FS", lagDays = 0) {
  if (predecessorId === successorId) return state;
  if (!RELATIONSHIP_TYPES.includes(relationshipType)) return state;
  if (!state.blocks.some((block) => block.id === predecessorId) || !state.blocks.some((block) => block.id === successorId)) return state;
  if (state.dependencies.some((dependency) => dependency.predecessorId === predecessorId && dependency.successorId === successorId)) return state;
  const dependency = Object.freeze({
    id: `dep${state.nextId}`, predecessorId, successorId, relationshipType,
    lagDays: Number.isInteger(lagDays) ? lagDays : 0,
  });
  return Object.freeze({ ...state, nextId: state.nextId + 1, dependencies: Object.freeze([...state.dependencies, dependency]) });
}

export function removeDependency(state, dependencyId) {
  return Object.freeze({ ...state, dependencies: Object.freeze(state.dependencies.filter((dependency) => dependency.id !== dependencyId)) });
}

// Chains consecutive pairs in `blockIds` as dependencies, in exactly the order given --
// e.g. [b1, b2, b3] links b1->b2 and b2->b3, not a fan-out from b1. Backs the "Link in
// order" multi-select action: Ctrl-click builds this ordered list, then this connects it.
export function linkBlocksInOrder(state, blockIds, relationshipType = "FS", lagDays = 0) {
  let next = state;
  for (let i = 0; i < blockIds.length - 1; i += 1) {
    next = addDependency(next, blockIds[i], blockIds[i + 1], relationshipType, lagDays);
  }
  return next;
}

export function dependenciesForBlock(state, blockId) {
  return Object.freeze({
    predecessors: Object.freeze(state.dependencies.filter((dependency) => dependency.successorId === blockId)),
    successors: Object.freeze(state.dependencies.filter((dependency) => dependency.predecessorId === blockId)),
  });
}

// Candidate predecessors for `blockId`: blocks in the same or an adjacent lane that finish
// at or near (within `thresholdWeeks`) the block's start — never auto-linked, just surfaced.
export function suggestPredecessors(state, blockId, { thresholdWeeks = 1 } = {}) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) return Object.freeze([]);
  const laneIdx = laneIndexOf(state, block.laneId);
  const alreadyLinked = new Set(state.dependencies.filter((d) => d.successorId === blockId).map((d) => d.predecessorId));
  return Object.freeze(state.blocks.filter((candidate) => {
    if (candidate.id === blockId || alreadyLinked.has(candidate.id)) return false;
    if (Math.abs(laneIndexOf(state, candidate.laneId) - laneIdx) > 1) return false;
    const candidateEnd = candidate.startIdx + (candidate.milestone ? 0 : candidate.duration);
    return Math.abs(candidateEnd - block.startIdx) <= thresholdWeeks;
  }));
}

// `resolveColumn` maps a real week index to the column it actually renders in -- identity
// unless "hide empty weeks" is compressing the timeline, in which case a block's own span
// is still contiguous in compressed space (compression only removes weeks nothing touches),
// so only the start column needs resolving; the span width in columns is unaffected.
export function blockAnchorPoint(block, laneIdx, weekWidth, edge, resolveColumn = (idx) => idx) {
  const y = laneIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
  const startCol = resolveColumn(block.startIdx);
  if (block.milestone) return Object.freeze({ x: startCol * weekWidth + weekWidth / 2, y });
  const startX = startCol * weekWidth + 2;
  const finishX = (startCol + block.duration) * weekWidth - 2;
  return Object.freeze({ x: edge === "start" ? startX : finishX, y });
}

const RELATIONSHIP_ANCHORS = Object.freeze({
  FS: Object.freeze(["finish", "start"]), SS: Object.freeze(["start", "start"]),
  FF: Object.freeze(["finish", "finish"]), SF: Object.freeze(["start", "finish"]),
});

// Returns {x1,y1,x2,y2} canvas-pixel coordinates for drawing a dependency's arrow, or null
// if either linked block no longer exists (shouldn't happen given the cascade-delete above,
// but arrow rendering should never throw on stale data).
export function dependencyArrowPoints(state, dependency, weekWidth, resolveColumn = (idx) => idx) {
  const predecessor = state.blocks.find((block) => block.id === dependency.predecessorId);
  const successor = state.blocks.find((block) => block.id === dependency.successorId);
  if (!predecessor || !successor) return null;
  const [predEdge, succEdge] = RELATIONSHIP_ANCHORS[dependency.relationshipType] || RELATIONSHIP_ANCHORS.FS;
  const from = blockAnchorPoint(predecessor, laneIndexOf(state, predecessor.laneId), weekWidth, predEdge, resolveColumn);
  const to = blockAnchorPoint(successor, laneIndexOf(state, successor.laneId), weekWidth, succEdge, resolveColumn);
  return Object.freeze({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
}

// Converts a placed block back into chip shape so copy/paste can reuse addBlock() --
// including its text style, so a copied block keeps its formatting.
export function blockToChip(block) {
  return Object.freeze({
    label: block.label, category: block.category, milestone: block.milestone,
    durationWeeks: block.milestone ? 0 : block.duration,
    fontSize: block.fontSize ?? null, textColor: block.textColor ?? null, bold: block.bold ?? true,
  });
}

export const TEXT_SIZE_OPTIONS = Object.freeze([
  Object.freeze({ label: "Small", value: 9 }),
  Object.freeze({ label: "Medium", value: BASE_BLOCK_FONT_SIZE_PX }),
  Object.freeze({ label: "Large", value: 14 }),
  Object.freeze({ label: "X-Large", value: 18 }),
]);

export const TEXT_COLOR_OPTIONS = Object.freeze([
  Object.freeze({ label: "Default", value: null }),
  Object.freeze({ label: "Black", value: "#0f172a" }),
  Object.freeze({ label: "White", value: "#ffffff" }),
  Object.freeze({ label: "Red", value: "#dc2626" }),
  Object.freeze({ label: "Blue", value: "#1d4ed8" }),
  Object.freeze({ label: "Green", value: "#15803d" }),
  Object.freeze({ label: "Amber", value: "#b45309" }),
]);

const TEXT_STYLE_KEYS = Object.freeze(["fontSize", "textColor", "bold"]);

// Applies a partial text-style patch (fontSize/textColor/bold) to every listed block --
// backs the topbar's size/color/bold toolbar, which can target a multi-selection at once.
export function setBlockTextStyle(state, blockIds, patch) {
  const idSet = new Set(blockIds);
  const cleanPatch = {};
  for (const key of TEXT_STYLE_KEYS) if (key in patch) cleanPatch[key] = patch[key];
  if (idSet.size === 0 || Object.keys(cleanPatch).length === 0) return state;
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) =>
      idSet.has(block.id) ? Object.freeze({ ...block, ...cleanPatch }) : block)),
  });
}

export function serializeBoardState(state) {
  return JSON.stringify(state, null, 2);
}

// Backfills fields missing from an older export/localStorage save (e.g. one made before
// task numbering existed) rather than leaving blocks with a blank taskCode.
export function deserializeBoardState(json) {
  const parsed = JSON.parse(json);
  const merged = { ...defaultBoardState(), ...parsed };
  let nextTaskNumber = Number.isInteger(merged.nextTaskNumber) ? merged.nextTaskNumber : FIRST_TASK_NUMBER;
  const blocks = (merged.blocks || []).map((block) => {
    let next = block;
    if (!next.taskCode) {
      next = { ...next, taskCode: `A${nextTaskNumber}` };
      nextTaskNumber += TASK_NUMBER_STEP;
    }
    if (!("fontSize" in next) || !("textColor" in next) || !("bold" in next)) {
      next = { ...next, fontSize: next.fontSize ?? null, textColor: next.textColor ?? null, bold: next.bold ?? true };
    }
    return next;
  });
  return Object.freeze({
    ...merged, nextTaskNumber, blocks: Object.freeze(blocks), dependencies: Object.freeze(merged.dependencies || []),
  });
}

// Undo/redo history is session-only UI state, deliberately kept separate from `board`
// itself (never persisted to localStorage, never exported/imported) -- these are pure
// stack operations the component wires up around its own board state.
export const HISTORY_LIMIT = 50;

export function emptyHistory() {
  return Object.freeze({ past: Object.freeze([]), future: Object.freeze([]) });
}

// Records `previousBoard` (the state a discrete edit just replaced) onto the undo stack
// and clears redo -- any new edit invalidates whatever redo history existed before it.
export function recordHistory(history, previousBoard) {
  const past = history.past.length >= HISTORY_LIMIT ? [...history.past.slice(1), previousBoard] : [...history.past, previousBoard];
  return Object.freeze({ past: Object.freeze(past), future: Object.freeze([]) });
}

// Returns { history, board }: the board to restore (or currentBoard unchanged if there's
// nothing to undo) and the updated stacks.
export function undoHistory(history, currentBoard) {
  if (history.past.length === 0) return { history, board: currentBoard };
  const board = history.past[history.past.length - 1];
  const future = history.future.length >= HISTORY_LIMIT ? [currentBoard, ...history.future.slice(0, -1)] : [currentBoard, ...history.future];
  return { history: Object.freeze({ past: Object.freeze(history.past.slice(0, -1)), future: Object.freeze(future) }), board };
}

export function redoHistory(history, currentBoard) {
  if (history.future.length === 0) return { history, board: currentBoard };
  const board = history.future[0];
  const past = history.past.length >= HISTORY_LIMIT ? [...history.past.slice(1), currentBoard] : [...history.past, currentBoard];
  return { history: Object.freeze({ past: Object.freeze(past), future: Object.freeze(history.future.slice(1)) }), board };
}
