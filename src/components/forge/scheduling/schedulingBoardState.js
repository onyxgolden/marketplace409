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

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function colorForCategory(category) {
  return CATEGORY_COLORS[category] || "#999999";
}

export function defaultBoardState() {
  return Object.freeze({
    projectName: "New Project",
    startDate: todayISO(0),
    endDate: todayISO(364),
    weekWidth: 90,
    lanes: DEFAULT_LANES,
    blocks: Object.freeze([]),
    customChips: Object.freeze([]),
    nextId: 1,
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
    label: chip.label,
    category: chip.category,
    milestone: !!chip.milestone,
    duration: chip.milestone ? 0 : Math.max(1, chip.durationWeeks || 1),
    startIdx: Math.max(0, weekIdx),
    laneId: lane.id,
  });
  return Object.freeze({ ...state, nextId: state.nextId + 1, blocks: Object.freeze([...state.blocks, block]) });
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

export function resizeBlock(state, blockId, duration) {
  const nextDuration = Math.max(1, duration);
  return Object.freeze({
    ...state,
    blocks: Object.freeze(state.blocks.map((block) =>
      block.id === blockId && !block.milestone ? Object.freeze({ ...block, duration: nextDuration }) : block)),
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

export function removeBlock(state, blockId) {
  return Object.freeze({ ...state, blocks: Object.freeze(state.blocks.filter((block) => block.id !== blockId)) });
}

export function addLane(state, name) {
  const trimmed = name?.trim();
  if (!trimmed) return state;
  const lane = Object.freeze({ id: `lane_${state.nextId}`, name: trimmed });
  return Object.freeze({ ...state, nextId: state.nextId + 1, lanes: Object.freeze([...state.lanes, lane]) });
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
  return Object.freeze({
    ...state,
    lanes: Object.freeze(state.lanes.filter((lane) => lane.id !== laneId)),
    blocks: Object.freeze(state.blocks.filter((block) => block.laneId !== laneId)),
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

// Converts a placed block back into chip shape so copy/paste can reuse addBlock().
export function blockToChip(block) {
  return Object.freeze({
    label: block.label, category: block.category, milestone: block.milestone,
    durationWeeks: block.milestone ? 0 : block.duration,
  });
}

export function serializeBoardState(state) {
  return JSON.stringify(state, null, 2);
}

export function deserializeBoardState(json) {
  const parsed = JSON.parse(json);
  return Object.freeze({ ...defaultBoardState(), ...parsed });
}
