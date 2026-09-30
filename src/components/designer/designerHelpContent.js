// designerHelpContent.js — plain-language topics and shortcuts for the
// Designer help panel. Content lives separately from DesignerHelpModal's
// rendering, matching the SchedulingHelpModal/RentalHelpModal convention of
// a data-only content module next to the component that renders it.

export const HELP_SHORTCUTS = [
  { label: "Save", description: "Ctrl+S (Cmd+S on a Mac)." },
  { label: "Undo", description: "Ctrl+Z (Cmd+Z on a Mac)." },
  { label: "Redo", description: "Ctrl+Shift+Z, or Ctrl+Y (Cmd+Shift+Z on a Mac)." },
];

export const HELP_SECTIONS = [
  {
    label: "Drawing the plan",
    description:
      "Pick a wall/room/door/window tool from the left palette, then click on the plan to draw. Switch to Select to move or resize anything you've drawn.",
  },
  {
    label: "Doors: which way they swing",
    description:
      "Select a door to see two on-canvas handles: ⇅ flips which side it opens to, ⇄ flips which edge the hinge is on. The inspector panel has the same two choices as plain buttons (\"Start edge/End edge\" and \"Side A/Side B\") if the icons aren't clear. A door always follows its wall's angle — to angle a door, draw its wall at that angle.",
  },
  {
    label: "Furniture: moving, resizing, rotating",
    description:
      "Drag a piece to move it, drag a corner handle to resize it, or drag the round handle above it to rotate (15° steps, hold Shift for 45°). Double-clicking a piece also rotates it.",
  },
  {
    label: "Symbols (outlets, equipment, etc.)",
    description: "Double-click a symbol on the plan to rotate it.",
  },
  {
    label: "Floors and walls: photos and colors",
    description:
      "Select a room to upload a photo of a flooring pattern, or select a wall to upload a wallpaper photo or pick a plain color from a photo. Walls ask you to choose Wallpaper or Color before the upload is used.",
  },
  {
    label: "Background image (tracing a photo or scan)",
    description: "Drag the image on the plan to position it, then lock it so it stops moving while you trace over it.",
  },
  {
    label: "2D, Split, and 3D views",
    description:
      "Switch between a flat 2D plan, a side-by-side Split view, and a walkable 3D View using the buttons in the toolbar. The unit toggle next to them switches all measurements between feet-and-inches and inches-only.",
  },
  {
    label: "Printing and exporting",
    description:
      "Print sends a sheet to your printer as drawn. DXF exports the plan for CAD software. GLB exports the 3D model for use elsewhere.",
  },
];
