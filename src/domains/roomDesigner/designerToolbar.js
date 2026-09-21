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
// under House, piping under Mechanical, process-engineering symbols under
// Process, and plan-level tools under Plan. A category with no tools is
// hidden, so Process appears automatically once its catalog lands.
export const TOOL_CATEGORIES = [
  { id: "house", label: "House", toolIds: ["wall", "wallrect", "room", "door", "window", "furniture"] },
  { id: "mechanical", label: "Mechanical", toolIds: ["pipe", "piping"] },
  { id: "process", label: "Process", toolIds: [] },
  { id: "plan", label: "Plan", toolIds: ["orgchart", "calibrate"] },
];

// Pure: groups ordered tool defs into pinned tools plus collapsible
// categories. Empty categories are skipped; a tool that is not listed in
// any category is returned in `ungrouped` so it can never silently vanish.
export function groupToolsByCategory(toolDefs) {
  const ordered = orderToolbarTools(toolDefs);
  const pinnedIds = new Set(PINNED_TOOL_IDS);
  const pinned = ordered.filter((tool) => pinnedIds.has(tool.id));
  const rest = ordered.filter((tool) => !pinnedIds.has(tool.id));
  const byId = new Map(rest.map((tool) => [tool.id, tool]));
  const used = new Set();
  const categories = [];
  for (const category of TOOL_CATEGORIES) {
    const tools = category.toolIds.map((id) => byId.get(id)).filter(Boolean);
    tools.forEach((tool) => used.add(tool.id));
    if (tools.length > 0) {
      categories.push({ id: category.id, label: category.label, tools });
    }
  }
  const ungrouped = rest.filter((tool) => !used.has(tool.id));
  return { pinned, categories, ungrouped };
}
