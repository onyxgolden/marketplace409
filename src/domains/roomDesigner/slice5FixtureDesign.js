// The representative Phone Slice 5 walkthrough plan: a 720" x 360"
// (60ft x 30ft) house with adjacent rooms and short divider walls, so
// the wall-dimension labels of neighboring walls sit a few plan-inches
// apart — the exact pile-up Jason's S26+ screenshot shows (144/216/168/
// 24/60/84/72 and two "Wood platform" deck labels clipping at the right
// edge). Shared by the dev fixture page (src/app/phone-fixture/page.jsx,
// measured by the Playwright geometry check) and the PlanCanvas
// phone-labels unit tests, so both exercise the same plan.
import { addDeck, addWall, createEmptyDesign } from "./designerDocument";

export function buildSlice5FixtureDesign() {
  let d = createEmptyDesign("Slice 5 fixture — 60ft x 30ft house");
  // Outer rectangle 720 x 360.
  d = addWall(d, { x: 0, y: 0 }, { x: 720, y: 0 });
  d = addWall(d, { x: 720, y: 0 }, { x: 720, y: 360 });
  d = addWall(d, { x: 720, y: 360 }, { x: 0, y: 360 });
  d = addWall(d, { x: 0, y: 360 }, { x: 0, y: 0 });
  // Closet/bath stack: three verticals 12" apart (the 24" label) — at
  // phone fit scale their dimension labels sit ~4px apart and pile into
  // each other, the exact stack Jason's screenshot shows.
  d = addWall(d, { x: 168, y: 0 }, { x: 168, y: 192 });
  d = addWall(d, { x: 180, y: 0 }, { x: 180, y: 192 });
  d = addWall(d, { x: 192, y: 0 }, { x: 192, y: 192 });
  d = addWall(d, { x: 168, y: 192 }, { x: 192, y: 192 });
  // Room divider: 144" + 216" segments.
  d = addWall(d, { x: 504, y: 0 }, { x: 504, y: 144 });
  d = addWall(d, { x: 504, y: 144 }, { x: 504, y: 360 });
  // Bath wall: two 84" segments.
  d = addWall(d, { x: 600, y: 192 }, { x: 600, y: 276 });
  d = addWall(d, { x: 600, y: 276 }, { x: 600, y: 360 });
  // Mid wall: 72" + 432" segments; the 168" cross wall; the 60" segment.
  d = addWall(d, { x: 0, y: 192 }, { x: 72, y: 192 });
  d = addWall(d, { x: 72, y: 192 }, { x: 504, y: 192 });
  d = addWall(d, { x: 288, y: 192 }, { x: 288, y: 360 });
  d = addWall(d, { x: 504, y: 288 }, { x: 648, y: 288 });
  d = addWall(d, { x: 648, y: 288 }, { x: 708, y: 288 });
  // Wood platforms: top-right (label clips at the right edge) and
  // bottom-center (label runs past the deck into the pane edge).
  d = addDeck(d, { x: 600, y: 0 }, { x: 720, y: 96 }, { material: "wood", dropIn: 4 });
  d = addDeck(d, { x: 288, y: 360 }, { x: 480, y: 432 }, { material: "wood", dropIn: 4 });
  return d;
}
