import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SchedulingBoard from "./SchedulingBoard";

describe("SchedulingBoard", () => {
  it("renders the default lanes and category palette", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("data-scheduling-board");
    expect(markup).toContain("Governance");
    expect(markup).toContain("Engineering");
    expect(markup).toContain("Field Execution");
    expect(markup).toContain("Shutdown &amp; Startup");
    expect(markup).toContain("Procurement");
  });

  it("renders the full capital/industrial starter chip set", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Long-Lead Equipment Fabrication");
    expect(markup).toContain("Pre-Startup Safety Review (PSSR)");
  });

  it("renders the topbar controls", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Export JSON");
    expect(markup).toContain("Import JSON");
    expect(markup).toContain("Reset board");
    expect(markup).toContain("+ Add lane");
  });

  it("offers Export XER and Export Project XML for the default (owner) board", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Export XER");
    expect(markup).toContain("Export Project XML");
  });

  it("shows the empty-board hint before anything is placed", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Drag a block from the left panel onto the grid to place it.");
  });

  it("renders the canvas grid lines as a tiling repeating-linear-gradient, not a single static gradient", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toMatch(/repeating-linear-gradient\(to right, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent 90px\)/);
    expect(markup).toMatch(/repeating-linear-gradient\(to bottom, #cbd5e1 0, #cbd5e1 1px, transparent 1px, transparent 46px\)/);
  });

  it("gives every lane an insert-above affordance, not just an append-at-the-end button", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup.match(/title="Insert lane above"/g)).toHaveLength(7); // one per default lane
  });

  it("always renders the dependency-arrow marker so links can draw as soon as they exist", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain('id="scheduling-dependency-arrow"');
  });

  it("does not render the dependency drawer until a block is selected", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-drawer");
  });

  it("does not render the multi-select link bar until 2+ blocks are Ctrl-selected", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-multi-select-bar");
    expect(markup).not.toContain("Link in order");
  });

  it("renders the text style toolbar disabled when nothing is selected", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Size…");
    expect(markup).toContain(">Default<");
    expect(markup).toContain('title="Toggle bold"');
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // size + color selects + bold button
  });

  it("shows the prebuilt-activities palette expanded by default with a collapse toggle", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(">Hide<");
    expect(markup).toContain("Governance"); // category list still rendered while expanded
  });

  it("renders the fit-to-project button and hide-empty-weeks toggle beside Zoom", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Fit to project");
    expect(markup).toContain("Hide empty weeks");
  });

  it("renders the full week grid (no columns collapsed) when the board has no blocks yet", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    // Default project window is 365 days -> 53 week columns; an empty board must never
    // collapse to zero columns just because nothing has been placed yet.
    expect(markup.match(/sticky top-0 z-30/g)?.length).toBe(53);
  });

  it("renders the lane-label column as a real frozen sibling, not a sticky grid item", () => {
    // position:sticky on a CSS grid item is confined to its own grid track's width (170px
    // here) -- once scrollLeft passes that, it has no room left to "stick" within and
    // scrolls away with everything else. Living outside the horizontally-scrolling grid
    // entirely (its own sibling div, kept in sync on scroll via syncLaneListScroll)
    // sidesteps that limit instead of fighting it.
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("sticky left-0");
    expect(markup).toContain('style="width:170px"');
    expect(markup.match(/sticky top-0 z-30/g)?.length).toBe(53); // only the week header row is sticky now
  });

  it("renders Undo and Redo disabled with an empty history", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain('title="Undo (Ctrl+Z)"');
    expect(markup).toContain('title="Redo (Ctrl+Shift+Z)"');
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(5); // +2 for Undo/Redo, on top of the disabled text-style toolbar
  });

  it("titles the view Gantt Chart and offers a Menu with a link back to the Projects list", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain(">Gantt Chart<");
    expect(markup).toContain("data-scheduling-menu");
    expect(markup).toContain('href="/forge/scheduling"');
    expect(markup).toContain("All Projects");
  });

  it("offers a WBS link under Menu when explicitly enabled, into this same project's WBS page", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard projectId="schedule_project_1" wbsEnabled />);
    expect(markup).toContain('href="/forge/scheduling/schedule_project_1/wbs"');
    expect(markup).toContain(">WBS<");
  });

  it("hides the WBS link by default (held back from production until it's ready)", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard projectId="schedule_project_1" />);
    expect(markup).not.toContain("/wbs");
    expect(markup).not.toContain(">WBS<");
  });

  it("renders a help button but not the help modal until it's opened", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain('title="Help &amp; keyboard shortcuts"');
    expect(markup).not.toContain("data-scheduling-help");
  });

  it("renders the critical path toggle and the (unused, until linked) red arrow marker", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Critical path");
    expect(markup).toContain('id="scheduling-dependency-arrow-critical"');
  });

  it("offers Baselines under Menu, alongside Calendars", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain(">Baselines<");
    expect(markup).toContain(">Calendars<");
  });

  it("does not render the baselines modal until it's opened", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-baselines");
  });

  it("offers Resources, Costs, EVM & DCMA, and Level Resources under Menu, for the default (owner) board", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain(">Resources<");
    expect(markup).toContain(">Costs<");
    expect(markup).toContain("EVM &amp; DCMA");
    expect(markup).toContain(">Level Resources<");
  });

  it("does not render the cycle-conflict banner on a fresh board with no cycle diagnosed yet", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-cycle-banner");
  });

  it("does not render the resources, costs, EVM/DCMA, or leveling modal until one is opened", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-resources");
    expect(markup).not.toContain("data-scheduling-costs");
    expect(markup).not.toContain("data-scheduling-evm-dcma");
    expect(markup).not.toContain("data-scheduling-leveling");
  });

  it("does not render the right-click context menu until a multi-selected block is right-clicked", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-context-menu");
    expect(markup).not.toContain("Link activities");
  });

  it("makes every week header draggable for measuring a day span, but shows no badge or band until one is dragged", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup.match(/title="Drag to measure a day span"/g)).toHaveLength(53);
    expect(markup).not.toContain("data-scheduling-measure-badge");
    expect(markup).not.toContain("data-scheduling-measure-band");
  });

  it("also makes the empty grid body itself draggable for measuring, not just the header row", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toMatch(/<div[^>]*data-scheduling-canvas[^>]*class="relative cursor-crosshair"[^>]*>/);
  });

  it("renders a Calendars menu entry but not the calendars modal until it's opened", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain(">Calendars<");
    expect(markup).not.toContain("data-scheduling-calendars");
  });

  it("shows a work-calendar dropdown under every lane, defaulting to the project's default calendar", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup.match(/data-scheduling-lane-calendar/g)).toHaveLength(7); // one per default lane
    expect(markup).toContain("Default (5-10s)");
  });

  it("grays out the default calendar's non-working days on a fresh board, but shows no blackout bands until one is added", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("data-scheduling-calendar-band");
    expect(markup).not.toContain("data-scheduling-blackout-band");
  });

  it("renders the board (not a load-error screen) and no read-only badge before the API load effect has run", () => {
    // renderToStaticMarkup never runs effects, so this documents the pre-fetch render: the
    // full board shows immediately (isOwner defaults true, loadError defaults null) rather
    // than a loading gate -- matches how the page always rendered before persistence moved
    // server-side, just with the placeholder board swapped for the real one once fetched.
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-load-error");
    expect(markup).not.toContain("data-scheduling-readonly-badge");
  });

  it("renders the data date line at the very start of a fresh board (today is both its start date and today)", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("data-scheduling-data-date-line");
    expect(markup).toMatch(/left:\s?0(px|["'])/); // day-offset 0 of week 0 -- the board's own start date
  });

  it("labels the starter-object palette with the board's own template category names, not a fixed global set", () => {
    // A bare <SchedulingBoard /> (no projectId, no template fetched) still falls back to the
    // capital template's names via defaultBoardState's own default -- this just confirms the
    // palette reads board.categoryNames rather than an import that can't vary per project.
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Project Governance");
    expect(markup).toContain("Project Engineering");
  });
});
