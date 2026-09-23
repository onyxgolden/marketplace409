// Toolbar ordering for the room Designer.
//
// Select, Erase and Pan are pinned as the first three tools, in that exact
// order, no matter where they (or future tools) are declared in the tool
// catalog. Everything else keeps its declared relative order after them.
export const PINNED_TOOL_IDS = ["select", "erase", "pan"];

// Pure: returns a new array, never mutates the input.
export function orderToolbarTools(toolDefs) {
  const byId = new Map(toolDefs.map((tool) => [tool.id, tool]));
  const pinned = PINNED_TOOL_IDS.map((id) => byId.get(id)).filter(Boolean);
  const pinnedIds = new Set(PINNED_TOOL_IDS);
  const rest = toolDefs.filter((tool) => !pinnedIds.has(tool.id));
  return [...pinned, ...rest];
}

// Visio-style stencil groups for the left tool palette. House stuff goes
// under House, pre-shaped rooms under Rooms, large drop-in structures
// (shipping containers) under Structures, piping under Mechanical,
// process-engineering symbols under Process, and plan-level tools under
// Plan. A category with no tools is hidden.
//
// NOTE: grouping is by explicit tool id, not by name prefix. A future tool
// like `process-pump` lands in `ungrouped` until the Process category's
// toolIds actually list it — either by registering a replacement via
// registerToolCategory({ id: "process", ... }) or by a slice that extends
// TOOL_CATEGORIES. There is no automatic prefix matching.
//
// The list is extensible: future slices (custom reusable shapes,
// process-engineering catalog) register their own categories at runtime via
// registerToolCategory() instead of editing this file. Categories may also
// be passed directly to groupToolsByCategory() as a second argument.
export const TOOL_CATEGORIES = [
  { id: "house", label: "House", toolIds: ["wall", "wallrect", "door", "window"] },
  {
    id: "rooms",
    label: "Rooms",
    toolIds: [
      "room-living-room",
      "room-bedroom",
      "room-bedroom-small",
      "room-bedroom-12x14",
      "room-kitchen",
      "room-kitchen-12x14",
      "room-dining-room",
      "room-master-bedroom",
      "room-bathroom",
      "room-bathroom-small",
      "room-garage",
      "room-office",
    ],
  },
  {
    id: "structures",
    label: "Structures",
    toolIds: ["structure-container-20", "structure-container-40"],
  },
  { id: "mechanical", label: "Mechanical", toolIds: ["pipe", "piping"] },
  { id: "process", label: "Process", toolIds: [] },
  { id: "plan", label: "Plan", toolIds: ["orgchart", "calibrate"] },
];

// Runtime-registered categories (custom shapes, future catalogs). Registering
// a category with an id that matches a built-in replaces that built-in.
const registeredCategories = new Map();

export function registerToolCategory(category) {
  if (!category || typeof category.id !== "string" || !Array.isArray(category.toolIds)) {
    throw new Error("registerToolCategory requires { id, label, toolIds }");
  }
  registeredCategories.set(category.id, {
    id: category.id,
    label: category.label || category.id,
    toolIds: [...category.toolIds],
  });
}

export function getToolCategories() {
  const merged = TOOL_CATEGORIES.map((c) => registeredCategories.get(c.id) || c);
  for (const [id, category] of registeredCategories) {
    if (!TOOL_CATEGORIES.some((c) => c.id === id)) merged.push(category);
  }
  return merged;
}

// Test/SSR helper: clears runtime-registered categories.
export function resetToolCategories() {
  registeredCategories.clear();
}

// Pure: groups ordered tool defs into pinned tools plus collapsible
// categories. Empty categories are skipped. A tool def with
// `leftPalette: false` is excluded from the left palette entirely (it can
// still live elsewhere, e.g. the furniture catalog's right panel). A tool
// that is not listed in any category is returned in `ungrouped` so it can
// never silently vanish.
export function groupToolsByCategory(toolDefs, categories = getToolCategories()) {
  // Fail fast on duplicate ids: without this, the Map below would silently
  // keep only the last def and React would get duplicate keys.
  const seenIds = new Set();
  for (const tool of toolDefs) {
    if (seenIds.has(tool.id)) {
      throw new Error(`groupToolsByCategory: duplicate tool id "${tool.id}"`);
    }
    seenIds.add(tool.id);
  }
  const visible = toolDefs.filter((tool) => tool.leftPalette !== false);
  const ordered = orderToolbarTools(visible);
  const pinnedIds = new Set(PINNED_TOOL_IDS);
  const pinned = ordered.filter((tool) => pinnedIds.has(tool.id));
  const rest = ordered.filter((tool) => !pinnedIds.has(tool.id));
  const byId = new Map(rest.map((tool) => [tool.id, tool]));
  const used = new Set();
  const groupedCategories = [];
  for (const category of categories) {
    const tools = category.toolIds.map((id) => byId.get(id)).filter(Boolean);
    tools.forEach((tool) => used.add(tool.id));
    if (tools.length > 0) {
      groupedCategories.push({ id: category.id, label: category.label, tools });
    }
  }
  const ungrouped = rest.filter((tool) => !used.has(tool.id));
  return { pinned, categories: groupedCategories, ungrouped };
}
