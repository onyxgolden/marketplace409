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
      { label: "Right-click a selected block", description: "With 2+ blocks selected, right-clicking one of them opens a menu with \"Link activities\" -- same result as the Link in order button." },
    ],
  },
  {
    title: "Dependencies",
    items: [
      { label: "Select a block", description: "Opens a drawer listing its Predecessors and Successors, each with a relationship type (FS/SS/FF/SF) and lag." },
      { label: "Duration field (drawer)", description: "Type a new duration in weeks, then press Enter or click away to resize the bar -- same as dragging the right edge. Disabled for milestones (always 0)." },
      { label: "Add link (drawer)", description: "Pick any other block, a direction, a relationship type, and lag days, then Add." },
      { label: "Click a Predecessor/Successor row", description: "Jumps the drawer to that linked block, so you can walk a chain and add or remove links along the way." },
      { label: "✕ on a Predecessor/Successor row", description: "Removes that relationship." },
      { label: "Suggested predecessors / successors", description: "One-click chips for blocks that finish right where the selected block starts, or start right where it finishes -- never added automatically, only suggested." },
      { label: "CPM info (drawer)", description: "Shows the selected block's calendar-computed early/late start and finish, total float, and whether it's on the critical path." },
      { label: "% complete / Actual start / finish (drawer)", description: "Track real progress separately from the schedule's computed dates -- feeds baseline variance, EVM, and DCMA's missed-task and baseline-execution checks." },
    ],
  },
  {
    title: "Lanes",
    items: [
      { label: "+ Add lane", description: "Adds a new lane at the bottom of the board." },
      { label: "+ next to a lane name", description: "Inserts a new lane directly above that one." },
      { label: "Double-click a lane name", description: "Rename the lane." },
      { label: "✕ next to a lane", description: "Delete the lane and any blocks placed on it." },
      { label: "Calendar dropdown under a lane name", description: "Assigns that lane's work calendar (4-10s, 5-10s, etc.). Leave it on \"Default\" to follow the project's default calendar instead." },
    ],
  },
  {
    title: "View controls",
    items: [
      { label: "Drag across the week header, or the empty grid", description: "Measures the day span between two dates -- shows a day-count badge in the header and highlights the range on the grid, handy for figuring out how far out to place an activity. Works starting from either the header row or empty space on the grid itself. Click empty canvas (without dragging) to clear it." },
      { label: "Zoom", description: "Slider controls how wide each week column renders." },
      { label: "Fit to project", description: "Shrinks the board so the entire project date range fits on screen without scrolling." },
      { label: "Hide empty weeks", description: "Collapses out any week with nothing scheduled in it, in any lane." },
      { label: "Hide / Show (palette)", description: "Collapses the \"Starter objects\" panel to free up space." },
      { label: "Text (Size / Color / B)", description: "Applies to whatever block(s) are currently selected." },
      { label: "Critical path", description: "Highlights every activity with zero total float in red -- the real critical path, computed from calendars, relationship types (FS/SS/FF/SF) with lag, and constraints, not just longest-chain-by-duration." },
      { label: "Data date line", description: "A solid blue vertical line marking today's date on the grid, same idea as P6's data date. Only shows when today falls within the project's own start/end dates." },
    ],
  },
  {
    title: "Project",
    items: [
      { label: "Apply dates", description: "Changes the project's overall start/end date range." },
      { label: "Export / Import JSON", description: "Save the current project to a file, or load one back in." },
      { label: "Export XER", description: "Downloads the project as a Primavera P6 .xer file -- activities, dependencies, calendars, and (if any) resources and costs." },
      { label: "Export Project XML", description: "Downloads the project in Microsoft Project's XML interchange format -- opens directly in Project via File > Open." },
      { label: "Reset board", description: "Clears placed blocks, dependencies, and custom chips, and reverts lanes to this project's own template -- undoable if you didn't mean to. Keeps the project's name, dates, and calendar setup as they were." },
      { label: "Menu -> All Projects", description: "Back to the list of saved projects. A template (Standard, Capital/Industrial, Home Remodel, New Home Construction, or Commercial) is picked there when starting a new one -- it sets the starting lanes, category labels, and starter chip palette." },
      { label: "Menu -> Calendars", description: "Build custom work calendars (which days of the week are worked) and set the project's default. Also where TA blackout windows are added -- date ranges no lane works, grayed out across the whole board regardless of calendar." },
    ],
  },
  {
    title: "Baselines",
    items: [
      { label: "Menu -> Baselines", description: "Capture a named snapshot of the current CPM-computed schedule." },
      { label: "Select a captured baseline", description: "Shows per-task and project-level variance against it -- start/finish/duration slip, plus anything added or removed since the baseline was captured." },
    ],
  },
  {
    title: "Resources & costs",
    items: [
      { label: "Menu -> Resources", description: "A dictionary of labor, nonlabor, and material resources shared across all of your scheduling projects -- name, type, max units/day, and standard rate." },
      { label: "Resources & costs (drawer)", description: "Assign a resource to the selected activity with budgeted units, or add a non-resource expense (a permit, a rental, etc.)." },
      { label: "Menu -> Costs", description: "Read-only budgeted/actual/remaining cost, project-wide and per activity, plus warnings for any resource booked over its daily capacity." },
    ],
  },
  {
    title: "EVM & DCMA",
    items: [
      { label: "Menu -> EVM & DCMA", description: "Earned value figures (PV/EV/AC, CPI/SPI, three EAC estimates) and the DCMA 14-point schedule health assessment, measured against a baseline and an as-of date you choose." },
    ],
  },
  {
    title: "Resource leveling",
    items: [
      { label: "Menu -> Level Resources", description: "Previews delaying non-critical, over-allocated activities within their own float to resolve resource conflicts -- least-float activities move last. \"Apply this leveling\" pins the moved dates as start-on constraints; nothing changes until you click it." },
      { label: "Allow extending the finish date", description: "If float alone can't resolve every conflict, lets leveling push activities (and the project finish) further out instead of leaving the conflict unresolved." },
    ],
  },
  {
    title: "Circular dependencies",
    items: [
      { label: "Red banner above the board", description: "Appears when a dependency loop makes part of the schedule uncomputable -- traces the actual loop (e.g. A -> B -> C -> A) and suggests which one link is most likely the mistake." },
      { label: "Remove this link", description: "One click applies the suggested fix; you can also resolve it manually via the dependency drawer." },
    ],
  },
]);
