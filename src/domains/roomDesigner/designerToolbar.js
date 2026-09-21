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
