// Content for the "?" help modal (see SchedulingHelpModal.jsx). Kept as plain data,
// separate from rendering, specifically so it's easy to append a new section or item
// here as each new scheduling feature ships -- no JSX/logic to touch, just this list.

export const HELP_SHORTCUTS = Object.freeze([
  { label: "Ctrl / Cmd + C", description: "Copy the selected block." },
  { label: "Ctrl / Cmd + V", description: "Paste the copied block into the same lane, just after where it was copied from." },
  { label: "Ctrl / Cmd + Z", description: "Undo the last change." },
  { label: "Ctrl / Cmd + Shift + Z", description: "Redo. Ctrl/Cmd + Y also works." },
  { label: "Ctrl / Cmd + Click a block", description: "Add or remove it from a multi-select, in the order you click them." },
]);

export const HELP_SECTIONS = Object.freeze([
  {
    title: "Blocks & bars",
    items: [
      { label: "Drag from the left palette", description: "Drop a starter block (or a custom one you've added) onto the grid to place it." },
      { label: "Drag a block", description: "Move it to a new date and/or lane. Dragging near the left/right edge of the screen auto-scrolls the timeline." },
      { label: "Drag the right edge", description: "Resize the bar -- the start date stays fixed, duration grows or shrinks." },
      { label: "Drag the left edge", description: "Resize from the start -- the finish date stays fixed instead." },
      { label: "Double-click a label", description: "Rename the block." },
      { label: "Right-click a block", description: "Copy it (same as Ctrl/Cmd + C)." },
      { label: "Hover + click the ✕", description: "Delete the block." },
      { label: "Click a block", description: "Select it -- opens the dependency drawer at the bottom." },
      { label: "Click empty canvas", description: "Clear the current selection." },
    ],
  },
  {
    title: "Multi-select & linking",
    items: [
      { label: "Ctrl/Cmd + click blocks", description: "Build an ordered multi-selection -- each selected block shows a numbered badge." },
      { label: "Drag a selected block", description: "With 2+ blocks selected, dragging any of them moves the whole group together, keeping their relative spacing." },
      { label: "Link in order (FS)", description: "Appears once 2+ blocks are selected -- chains them as Finish-to-Start dependencies in the order you clicked, not a fan-out from the first one." },
    ],
  },
  {
    title: "Dependencies",
    items: [
      { label: "Select a block", description: "Opens a drawer listing its Predecessors and Successors, each with a relationship type (FS/SS/FF/SF) and lag." },
      { label: "Add link (drawer)", description: "Pick any other block, a direction, a relationship type, and lag days, then Add." },
      { label: "Suggested predecessors", description: "One-click chips for blocks that finish right where the selected block starts -- never added automatically, only suggested." },
    ],
  },
  {
    title: "Lanes",
    items: [
      { label: "+ Add lane", description: "Adds a new lane at the bottom of the board." },
      { label: "+ next to a lane name", description: "Inserts a new lane directly above that one." },
      { label: "Double-click a lane name", description: "Rename the lane." },
      { label: "✕ next to a lane", description: "Delete the lane and any blocks placed on it." },
    ],
  },
  {
    title: "View controls",
    items: [
      { label: "Zoom", description: "Slider controls how wide each week column renders." },
      { label: "Fit to project", description: "Shrinks the board so the entire project date range fits on screen without scrolling." },
      { label: "Hide empty weeks", description: "Collapses out any week with nothing scheduled in it, in any lane." },
      { label: "Hide / Show (palette)", description: "Collapses the \"Starter objects\" panel to free up space." },
      { label: "Text (Size / Color / B)", description: "Applies to whatever block(s) are currently selected." },
      { label: "Critical path", description: "Highlights the longest dependency-linked chain by duration in red. A simplified stand-in for real CPM until calendars and constraints exist -- not tied to actual float or scheduling logic yet." },
    ],
  },
  {
    title: "Project",
    items: [
      { label: "Apply dates", description: "Changes the project's overall start/end date range." },
      { label: "Export / Import JSON", description: "Save the current project to a file, or load one back in." },
      { label: "Reset board", description: "Clears everything -- undoable if you didn't mean to." },
      { label: "Menu -> All Projects", description: "Back to the list of saved projects." },
    ],
  },
]);
