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

// Every template reuses the same 5 category slots (fixed colors, see CATEGORY_COLORS) with
// different display names and lane sets appropriate to that kind of project -- e.g. "proc"
// means long-lead equipment procurement for a capital project, but land/lot purchasing for
// a new-build home. This keeps all the existing category-keyed rendering (palette grouping,
// block colors, the custom-chip category dropdown) working unchanged across templates; only
// the labels and starter content differ, both carried on the board itself once created (see
// defaultBoardState) so a project stays self-contained even if this registry changes later.
function lanes(...names) {
  return Object.freeze(names.map((name, i) => Object.freeze({ id: `lane_${i}`, name })));
}
function chip(label, category, durationWeeks, milestone = false) {
  return Object.freeze({ label, category, durationWeeks: milestone ? 0 : durationWeeks, milestone });
}

export const PROJECT_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "standard", name: "Standard Project",
    description: "A domain-neutral starting point -- planning, design, procurement, execution, and closeout -- for anything the other templates don't fit.",
    categoryNames: Object.freeze({
      gov: "Planning & Approvals", eng: "Design & Engineering", proc: "Procurement", field: "Execution", shut: "Closeout",
    }),
    lanes: lanes("Milestones", "Planning & Approvals", "Design & Engineering", "Procurement", "Execution", "Execution (cont.)", "Closeout"),
    chips: Object.freeze([
      chip("Project Kickoff", "gov", 0, true),
      chip("Charter / Scope Approval", "gov", 1),
      chip("Stakeholder Review", "gov", 1),
      chip("Funding / Budget Approval", "gov", 0, true),
      chip("Change Management Review", "gov", 1),
      chip("Requirements Gathering", "eng", 2),
      chip("Conceptual Design", "eng", 3),
      chip("Detailed Design", "eng", 4),
      chip("Design Review", "eng", 1),
      chip("Design Approval", "eng", 0, true),
      chip("RFQ Issued", "proc", 0, true),
      chip("Bid Evaluation", "proc", 2),
      chip("PO Issued", "proc", 0, true),
      chip("Vendor / Material Lead Time", "proc", 4),
      chip("Delivery Received", "proc", 0, true),
      chip("Mobilization", "field", 0, true),
      chip("Phase 1 Execution", "field", 3),
      chip("Phase 2 Execution", "field", 3),
      chip("Installation / Build", "field", 4),
      chip("Testing", "field", 2),
      chip("Quality Inspection", "field", 1),
      chip("Progress Review", "field", 1),
      chip("Punch List", "shut", 1),
      chip("Final Inspection", "shut", 0, true),
      chip("Documentation Handover", "shut", 1),
      chip("Client / Stakeholder Sign-off", "shut", 0, true),
      chip("Project Closeout", "shut", 0, true),
    ]),
  }),
  Object.freeze({
    id: "capital", name: "Capital / Industrial Project",
    description: "Turnarounds, plant outages, and capital projects -- governance, engineering, procurement, field execution, shutdown/startup.",
    categoryNames: CATEGORY_NAMES,
    lanes: DEFAULT_LANES,
    chips: DEFAULT_CHIPS,
  }),
  Object.freeze({
    id: "home_remodel", name: "Home Remodel",
    description: "Planning and permitting through demo, rough-in, finishes, and closeout for a residential remodel.",
    categoryNames: Object.freeze({
      gov: "Planning & Permitting", eng: "Design", proc: "Materials & Procurement", field: "Construction", shut: "Closeout",
    }),
    lanes: lanes("Milestones", "Planning & Permitting", "Design", "Demolition", "Rough-In", "Finishes", "Closeout"),
    chips: Object.freeze([
      chip("Design / Scope Finalized", "gov", 0, true),
      chip("Contractor Selected", "gov", 0, true),
      chip("Permit Application Submitted", "gov", 1),
      chip("Permit Approved", "gov", 0, true),
      chip("Material Selections Finalized", "gov", 1),
      chip("Measure & Design", "eng", 2),
      chip("Structural Engineering Review", "eng", 1),
      chip("Plan Revisions", "eng", 1),
      chip("Cabinet Order", "proc", 1),
      chip("Countertop Template & Order", "proc", 1),
      chip("Fixture & Appliance Selection", "proc", 1),
      chip("Flooring Material Order", "proc", 1),
      chip("Site Protection Setup", "field", 1),
      chip("Demolition", "field", 1),
      chip("Framing Modifications", "field", 1),
      chip("Rough Plumbing", "field", 1),
      chip("Rough Electrical", "field", 1),
      chip("Rough HVAC", "field", 1),
      chip("Rough-In Inspection", "field", 0, true),
      chip("Insulation", "field", 1),
      chip("Drywall Hang", "field", 1),
      chip("Drywall Finish", "field", 1),
      chip("Interior Paint", "field", 1),
      chip("Flooring Install", "field", 1),
      chip("Cabinet Install", "field", 1),
      chip("Countertop Install", "field", 1),
      chip("Trim & Millwork", "field", 1),
      chip("Tile Work", "field", 1),
      chip("Fixture Install", "field", 1),
      chip("Appliance Install", "field", 1),
      chip("Final Cleaning", "shut", 1),
      chip("Punch List", "shut", 1),
      chip("Final Inspection", "shut", 0, true),
      chip("Owner Walkthrough", "shut", 0, true),
    ]),
  }),
  Object.freeze({
    id: "home_construction", name: "New Home Construction",
    description: "Lot purchase and house plans through site work, foundation, framing, MEP, finishes, and closeout for a from-scratch build.",
    categoryNames: Object.freeze({
      gov: "Land & Permitting", eng: "Design & Engineering", proc: "Procurement", field: "Construction", shut: "Closeout",
    }),
    lanes: lanes("Milestones", "Land & Permitting", "Design & Engineering", "Site Work", "Foundation",
      "Framing & Shell", "Rough-In (MEP)", "Interior & Exterior Finishes", "Closeout"),
    chips: Object.freeze([
      chip("Lot / Land Search", "gov", 2),
      chip("Land Purchase Contract", "gov", 1),
      chip("Land Closing", "gov", 0, true),
      chip("Building Permit Submitted", "gov", 1),
      chip("Building Permit Approved", "gov", 0, true),
      chip("Architectural Plans", "eng", 3),
      chip("Structural Engineering", "eng", 2),
      chip("Civil / Site Engineering", "eng", 2),
      chip("Plan Review & Revisions", "eng", 1),
      chip("Lumber Package Order", "proc", 1),
      chip("Windows & Doors Order", "proc", 1),
      chip("Cabinet & Countertop Order", "proc", 1),
      chip("Appliance Order", "proc", 1),
      chip("Site Clearing & Grading", "field", 1),
      chip("Utility Installation", "field", 1),
      chip("Footings", "field", 1),
      chip("Foundation Walls / Slab", "field", 1),
      chip("Foundation Inspection", "field", 0, true),
      chip("Framing", "field", 3),
      chip("Roof Trusses & Sheathing", "field", 1),
      chip("Roofing", "field", 1),
      chip("Windows & Exterior Doors", "field", 1),
      chip("Dry-In", "field", 0, true),
      chip("Rough Plumbing", "field", 1),
      chip("Rough Electrical", "field", 1),
      chip("Rough HVAC", "field", 1),
      chip("Rough-In Inspection", "field", 0, true),
      chip("Insulation", "field", 1),
      chip("Drywall", "field", 2),
      chip("Siding / Exterior Finish", "field", 2),
      chip("Interior Paint", "field", 1),
      chip("Flooring", "field", 1),
      chip("Cabinets & Countertops", "field", 1),
      chip("Trim & Interior Doors", "field", 1),
      chip("Fixtures & Appliances", "field", 1),
      chip("Driveway & Landscaping", "field", 1),
      chip("Final Grade", "shut", 1),
      chip("Final Inspection", "shut", 0, true),
      chip("Certificate of Occupancy", "shut", 0, true),
      chip("Closing / Owner Walkthrough", "shut", 0, true),
    ]),
  }),
  Object.freeze({
    id: "commercial_construction", name: "Commercial Building / Property",
    description: "Entitlements and design through site work, structural shell, MEP, build-out, and life-safety closeout for a commercial property.",
    categoryNames: Object.freeze({
      gov: "Entitlements & Design", eng: "Structural & Engineering", proc: "Procurement", field: "Construction", shut: "Life Safety & Closeout",
    }),
    lanes: lanes("Milestones", "Entitlements & Design", "Site Work", "Structural & Shell",
      "MEP Systems", "Interior Build-Out", "Life Safety & Commissioning", "Closeout"),
    chips: Object.freeze([
      chip("Site Selection", "gov", 2),
      chip("Zoning / Entitlement Approval", "gov", 0, true),
      chip("Architectural Design", "gov", 4),
      chip("Permit Submission", "gov", 1),
      chip("Permit Approval", "gov", 0, true),
      chip("Structural Engineering", "eng", 3),
      chip("Civil Engineering", "eng", 2),
      chip("MEP Engineering Design", "eng", 2),
      chip("Value Engineering Review", "eng", 1),
      chip("Structural Steel Order", "proc", 1),
      chip("Curtain Wall / Facade Package", "proc", 1),
      chip("MEP Equipment Order", "proc", 1),
      chip("Elevator Order", "proc", 1),
      chip("Site Clearing & Grading", "field", 1),
      chip("Utility Installation", "field", 1),
      chip("Paving & Parking Lot", "field", 1),
      chip("Stormwater Management", "field", 1),
      chip("Foundation", "field", 2),
      chip("Structural Steel / Concrete Frame", "field", 4),
      chip("Roofing", "field", 2),
      chip("Building Envelope / Facade", "field", 3),
      chip("Weathertight", "field", 0, true),
      chip("Mechanical (HVAC) Rough-In", "field", 2),
      chip("Electrical Rough-In", "field", 2),
      chip("Plumbing Rough-In", "field", 2),
      chip("Fire Sprinkler Rough-In", "field", 1),
      chip("Interior Framing", "field", 2),
      chip("Drywall & Ceilings", "field", 2),
      chip("Flooring", "field", 1),
      chip("Paint & Finishes", "field", 1),
      chip("Tenant Improvements", "field", 2),
      chip("Fire Alarm System", "shut", 1),
      chip("Fire Sprinkler Final", "shut", 1),
      chip("Elevator Install & Inspection", "shut", 1),
      chip("Life Safety Inspection", "shut", 0, true),
      chip("Final Inspections", "shut", 1),
      chip("Certificate of Occupancy", "shut", 0, true),
      chip("Substantial Completion", "shut", 0, true),
      chip("Tenant Move-In / Turnover", "shut", 0, true),
    ]),
  }),
]);

export function projectTemplateById(templateId) {
  return PROJECT_TEMPLATES.find((template) => template.id === templateId) || PROJECT_TEMPLATES[0];
}

// Presets seed every new board's calendar list; the builder UI lets a project add more
// (or delete these) from there, they're just a starting point, not a fixed enum. Working
// days are stored as JS Date.getDay() values (0=Sun..6=Sat), not week-column offsets, so
// they're independent of any particular project's start date.
export const CALENDAR_PRESETS = Object.freeze([
  Object.freeze({ id: "cal_4_10s", name: "4-10s", workingDays: Object.freeze([1, 2, 3, 4]) }),
  Object.freeze({ id: "cal_4_10s_8", name: "4-10s + 8", workingDays: Object.freeze([1, 2, 3, 4, 5]) }),
  Object.freeze({ id: "cal_5_10s", name: "5-10s", workingDays: Object.freeze([1, 2, 3, 4, 5]) }),
  Object.freeze({ id: "cal_6_10s", name: "6-10s", workingDays: Object.freeze([1, 2, 3, 4, 5, 6]) }),
  Object.freeze({ id: "cal_7_10s", name: "7-10s", workingDays: Object.freeze([0, 1, 2, 3, 4, 5, 6]) }),
]);

export const WEEKDAY_LABELS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

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

export function generateProjectId() {
  return `schedule_project_${crypto.randomUUID()}`;
}

// `id` is a param (not always freshly generated) so deserializeBoardState can rebuild a
// saved project's exact defaults rather than handing it a new random identity. `templateId`
// only matters at creation time -- lanes, starterChips, and categoryNames are copied onto
// the board itself here, not looked up by templateId on every read, so a project stays
// exactly as it started even if PROJECT_TEMPLATES changes later (a later edit to a template
// is a change to the catalog, not a retroactive edit to every project built from it).
export function defaultBoardState(id = generateProjectId(), templateId = "capital") {
  const now = new Date().toISOString();
  const template = projectTemplateById(templateId);
  return Object.freeze({
    id,
    projectName: "New Project",
    templateId: template.id,
    startDate: todayISO(0),
    endDate: todayISO(364),
    weekWidth: 90,
    lanes: template.lanes,
    categoryNames: template.categoryNames,
    starterChips: template.chips,
    blocks: Object.freeze([]),
    dependencies: Object.freeze([]),
    customChips: Object.freeze([]),
    calendars: CALENDAR_PRESETS,
    defaultCalendarId: "cal_5_10s",
    blackoutWindows: Object.freeze([]),
    nextId: 1,
    nextTaskNumber: FIRST_TASK_NUMBER,
    createdAt: now,
    updatedAt: now,
  });
}

// "Reset board" clears placed content and reverts lanes to this board's own template's
// starting set -- but keeps the project's own identity (id, name, dates) and its calendar/
// blackout setup, neither of which a content reset is meant to touch. Deliberately not just
// defaultBoardState(state.id) again: that would also mint a fresh random templateId-less
// board, discarding categoryNames/starterChips/calendars, and (worse) if called with no id
// override at all would silently swap in a brand new id, breaking every future autosave for
// this project since the URL/API calls still target the original one.
export function resetBoard(state) {
  const template = projectTemplateById(state.templateId);
  return Object.freeze({
    ...state,
    lanes: template.lanes,
    blocks: Object.freeze([]),
    dependencies: Object.freeze([]),
    customChips: Object.freeze([]),
    nextId: 1,
    nextTaskNumber: FIRST_TASK_NUMBER,
  });
}

// Projection for the Projects list screen -- picks out just the columns it displays,
// used server-side (src/app/api/forge/scheduling/route.js) to avoid shipping every
// project's full board down to the list view.
export function projectSummaryFromBoard(board) {
  return Object.freeze({
    id: board.id, name: board.projectName, startDate: board.startDate, endDate: board.endDate,
    createdAt: board.createdAt, updatedAt: board.updatedAt,
  });
}

export function parseISODate(value) {
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
  return [...(state.starterChips || DEFAULT_CHIPS), ...state.customChips];
}
export function chipsByCategory(state) {
  const grouped = {};
  for (const category of Object.keys(state.categoryNames || CATEGORY_NAMES)) grouped[category] = [];
  for (const item of allChips(state)) {
    if (grouped[item.category]) grouped[item.category].push(item);
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

export function calendarById(state, calendarId) {
  return state.calendars.find((calendar) => calendar.id === calendarId) || null;
}

// A lane with no calendarId of its own inherits the project's default -- set at addLane
// time never, deliberately, so changing the project default retroactively affects every
// lane that hasn't been explicitly overridden.
export function calendarForLane(state, laneId) {
  const lane = state.lanes.find((item) => item.id === laneId);
  return calendarById(state, lane?.calendarId) || calendarById(state, state.defaultCalendarId) || state.calendars[0] || null;
}

// Contiguous runs of non-working day-offsets (0-6) within a week column for a calendar.
// Every column is treated as running Monday (offset 0) through Sunday (offset 6) for
// calendar purposes, regardless of which weekday the project's actual start date falls
// on -- so a lane's off days always land in the same place every week (Saturday/Sunday
// trailing the column for a standard calendar) instead of wherever the project happened
// to kick off. This is deliberately independent of any real date, which is also why the
// pattern is identical in every column and doesn't need to be recomputed per column.
export function nonWorkingDayRuns(calendar) {
  if (!calendar) return [];
  const runs = [];
  let runStart = null;
  for (let d = 0; d <= 6; d += 1) {
    const working = calendar.workingDays.includes((d + 1) % 7); // offset 0=Mon..6=Sun
    if (!working && runStart === null) runStart = d;
    if (working && runStart !== null) { runs.push([runStart, d - 1]); runStart = null; }
  }
  if (runStart !== null) runs.push([runStart, 6]);
  return runs;
}

export function addCalendar(state, { name, workingDays }) {
  const trimmed = name?.trim();
  if (!trimmed || !Array.isArray(workingDays) || workingDays.length === 0) return state;
  const calendar = Object.freeze({
    id: `cal_${state.nextId}`, name: trimmed,
    workingDays: Object.freeze([...new Set(workingDays)].sort((a, b) => a - b)),
  });
  return Object.freeze({ ...state, nextId: state.nextId + 1, calendars: Object.freeze([...state.calendars, calendar]) });
}

export function updateCalendar(state, calendarId, { name, workingDays } = {}) {
  return Object.freeze({
    ...state,
    calendars: Object.freeze(state.calendars.map((calendar) => {
      if (calendar.id !== calendarId) return calendar;
      const nextName = name?.trim() || calendar.name;
      const nextDays = Array.isArray(workingDays) && workingDays.length > 0
        ? Object.freeze([...new Set(workingDays)].sort((a, b) => a - b)) : calendar.workingDays;
      return Object.freeze({ ...calendar, name: nextName, workingDays: nextDays });
    })),
  });
}

// Refuses to delete the project's current default (pick a new default first) so the board
// is never left without one; any lane pinned to the deleted calendar falls back to
// inheriting the default rather than keeping a dangling calendarId.
export function removeCalendar(state, calendarId) {
  if (calendarId === state.defaultCalendarId) return state;
  return Object.freeze({
    ...state,
    calendars: Object.freeze(state.calendars.filter((calendar) => calendar.id !== calendarId)),
    lanes: Object.freeze(state.lanes.map((lane) =>
      (lane.calendarId === calendarId ? Object.freeze({ ...lane, calendarId: null }) : lane))),
  });
}

export function setDefaultCalendar(state, calendarId) {
  if (!state.calendars.some((calendar) => calendar.id === calendarId)) return state;
  return Object.freeze({ ...state, defaultCalendarId: calendarId });
}

export function setLaneCalendar(state, laneId, calendarId) {
  return Object.freeze({
    ...state,
    lanes: Object.freeze(state.lanes.map((lane) =>
      (lane.id === laneId ? Object.freeze({ ...lane, calendarId: calendarId || null }) : lane))),
  });
}

export function addBlackoutWindow(state, { label, startDate, endDate }) {
  const trimmed = label?.trim();
  if (!trimmed || !startDate || !endDate || parseISODate(endDate) < parseISODate(startDate)) return state;
  const blackout = Object.freeze({ id: `blackout_${state.nextId}`, label: trimmed, startDate, endDate });
  return Object.freeze({ ...state, nextId: state.nextId + 1, blackoutWindows: Object.freeze([...state.blackoutWindows, blackout]) });
}

export function removeBlackoutWindow(state, blackoutId) {
  return Object.freeze({ ...state, blackoutWindows: Object.freeze(state.blackoutWindows.filter((b) => b.id !== blackoutId)) });
}

// Contiguous runs of day-offsets (0-6) within one specific week column that fall inside
// any blackout window. Unlike nonWorkingDayRuns this genuinely needs that column's real
// calendar date -- blackouts are one-off date ranges (a TA freeze, a holiday shutdown),
// not a recurring weekly pattern -- so, unlike nonWorkingDayRuns, it takes the column's own real start date.
export function blackoutDayRuns(state, weekStartIso) {
  if (!state.blackoutWindows.length) return [];
  const weekStart = parseISODate(weekStartIso);
  const windows = state.blackoutWindows.map((w) => [parseISODate(w.startDate), parseISODate(w.endDate)]);
  const runs = [];
  let runStart = null;
  for (let d = 0; d <= 6; d += 1) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + d);
    const blacked = windows.some(([start, end]) => date >= start && date <= end);
    if (blacked && runStart === null) runStart = d;
    if (!blacked && runStart !== null) { runs.push([runStart, d - 1]); runStart = null; }
  }
  if (runStart !== null) runs.push([runStart, 6]);
  return runs;
}

// Where the "data date" line (P6's term for the current/as-of date -- today, by default)
// falls on the grid: which real week column, and the day-offset (0-6) within that column's
// own real start date -- same real-date basis as blackoutDayRuns, not the calendar-shading
// convention in nonWorkingDayRuns. Returns null when the date is outside the project's own
// date range entirely, so the board draws no line rather than one off the edge of the grid.
export function dataDateOffset(startDate, endDate, todayIso = todayISO()) {
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);
  const today = parseISODate(todayIso);
  if (today < start || today > end) return null;
  const diffDays = Math.round((today - start) / (24 * 60 * 60 * 1000));
  return Object.freeze({ realIdx: Math.floor(diffDays / 7), dayOffset: diffDays % 7 });
}

export function addCustomChip(state, { label, category, durationWeeks, milestone }) {
  const trimmed = label?.trim();
  // Validated against the fixed 5 category slots (CATEGORY_COLORS), not this board's own
  // categoryNames -- the slots themselves are permanent across every template, only their
  // display names vary, and a board without categoryNames yet (an older save) should still
  // accept a chip in any of the 5 slots.
  if (!trimmed || !CATEGORY_COLORS[category]) return state;
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

// Candidate successors for `blockId`: blocks in the same or an adjacent lane that start
// at or near (within `thresholdWeeks`) the block's finish — never auto-linked, just surfaced.
export function suggestSuccessors(state, blockId, { thresholdWeeks = 1 } = {}) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) return Object.freeze([]);
  const laneIdx = laneIndexOf(state, block.laneId);
  const blockEnd = block.startIdx + (block.milestone ? 0 : block.duration);
  const alreadyLinked = new Set(state.dependencies.filter((d) => d.predecessorId === blockId).map((d) => d.successorId));
  return Object.freeze(state.blocks.filter((candidate) => {
    if (candidate.id === blockId || alreadyLinked.has(candidate.id)) return false;
    if (Math.abs(laneIndexOf(state, candidate.laneId) - laneIdx) > 1) return false;
    return Math.abs(candidate.startIdx - blockEnd) <= thresholdWeeks;
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

// How far the line travels away from the predecessor before turning down/up toward the
// successor's lane -- keeps the elbow's final leg (the one that determines the arrowhead's
// orientation) comfortably clear of the predecessor block it just left.
const DEPENDENCY_ELBOW_STUB_PX = 14;

// Returns {x1,y1,x2,y2,d} canvas-pixel coordinates for drawing a dependency's arrow, or null
// if either linked block no longer exists (shouldn't happen given the cascade-delete above,
// but arrow rendering should never throw on stale data). x1/y1/x2/y2 are the predecessor/
// successor anchor points; `d` is the SVG path to actually render: a straight line when both
// blocks share a lane, otherwise a 90-degree elbow (out from the predecessor, across to the
// successor's lane, then straight in) so the arrow always lands square-on at the successor's
// edge instead of cutting across it diagonally.
export function dependencyArrowPoints(state, dependency, weekWidth, resolveColumn = (idx) => idx) {
  const predecessor = state.blocks.find((block) => block.id === dependency.predecessorId);
  const successor = state.blocks.find((block) => block.id === dependency.successorId);
  if (!predecessor || !successor) return null;
  const [predEdge, succEdge] = RELATIONSHIP_ANCHORS[dependency.relationshipType] || RELATIONSHIP_ANCHORS.FS;
  const from = blockAnchorPoint(predecessor, laneIndexOf(state, predecessor.laneId), weekWidth, predEdge, resolveColumn);
  const to = blockAnchorPoint(successor, laneIndexOf(state, successor.laneId), weekWidth, succEdge, resolveColumn);
  if (from.y === to.y) return Object.freeze({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, d: `M${from.x},${from.y} L${to.x},${to.y}` });
  // Exit the predecessor in the direction its edge naturally points (finish -> forward,
  // start -> backward), then drop/rise to the successor's lane, then run straight in.
  const stubDirection = predEdge === "finish" ? 1 : -1;
  const midX = from.x + stubDirection * DEPENDENCY_ELBOW_STUB_PX;
  const d = `M${from.x},${from.y} L${midX},${from.y} L${midX},${to.y} L${to.x},${to.y}`;
  return Object.freeze({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, d });
}

// A simplified stand-in for real CPM critical-path analysis (which needs calendars and
// constraints, not built yet): the chain of dependency-linked blocks whose durations sum
// to the largest total. No lag, no calendars -- just longest-path-by-duration through the
// dependency graph, for visually sanity-checking the graph while building it out.
//
// Cycle-safe by construction: `visiting` cuts a path off (treats it as length 0 from that
// point) the moment it would revisit a block still on the current call stack, rather than
// recursing forever. addDependency doesn't reject cycles today, so this has to tolerate one
// existing without hanging.
export function criticalPath(state) {
  const successorsOf = new Map();
  for (const dependency of state.dependencies) {
    if (!successorsOf.has(dependency.predecessorId)) successorsOf.set(dependency.predecessorId, []);
    successorsOf.get(dependency.predecessorId).push(dependency.successorId);
  }
  const durationOf = new Map(state.blocks.map((block) => [block.id, block.milestone ? 0 : block.duration]));
  const memo = new Map();
  const visiting = new Set();

  function longestFrom(blockId) {
    if (memo.has(blockId)) return memo.get(blockId);
    if (visiting.has(blockId)) return { length: 0, path: [] };
    visiting.add(blockId);
    let best = { length: durationOf.get(blockId) || 0, path: [blockId] };
    for (const successorId of successorsOf.get(blockId) || []) {
      if (!durationOf.has(successorId)) continue; // dependency pointing at a block that no longer exists
      const sub = longestFrom(successorId);
      const candidateLength = (durationOf.get(blockId) || 0) + sub.length;
      if (candidateLength > best.length) best = { length: candidateLength, path: [blockId, ...sub.path] };
    }
    visiting.delete(blockId);
    memo.set(blockId, best);
    return best;
  }

  let overallBest = null;
  for (const block of state.blocks) {
    const result = longestFrom(block.id);
    // A lone block isn't a "path" worth calling critical -- require an actual chain.
    if (result.path.length < 2) continue;
    if (!overallBest || result.length > overallBest.length) overallBest = result;
  }
  const blockIds = overallBest ? overallBest.path : [];
  const dependencyIds = [];
  for (let i = 0; i < blockIds.length - 1; i += 1) {
    const dependency = state.dependencies.find((d) => d.predecessorId === blockIds[i] && d.successorId === blockIds[i + 1]);
    if (dependency) dependencyIds.push(dependency.id);
  }
  return Object.freeze({ blockIds: Object.freeze(blockIds), dependencyIds: Object.freeze(dependencyIds) });
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

// Backfills fields missing from an older export/save (e.g. one made before task numbering
// existed) rather than leaving blocks with a blank taskCode. Takes an already-parsed
// object, not a JSON string -- shared by deserializeBoardState (JSON file import) and the
// scheduling API routes (a jsonb column comes back from supabase-js as a plain object
// already, needing the exact same backfill without a redundant parse/stringify round trip).
export function hydrateBoardState(parsed) {
  // Passing parsed.id through (undefined falls back to a fresh id via the default param)
  // means an existing project keeps its identity across saves; only a save from before
  // ids existed gets a newly-generated one, same backfill spirit as taskCode below.
  const merged = { ...defaultBoardState(parsed.id), ...parsed };
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

export function deserializeBoardState(json) {
  return hydrateBoardState(JSON.parse(json));
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
