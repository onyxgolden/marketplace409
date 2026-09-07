// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SchedulingBoard from "./SchedulingBoard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

  it("offers Export XER, Export Project XML, Export Excel, and Import Excel for the default (owner) board", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain("Export XER");
    expect(markup).toContain("Export Project XML");
    expect(markup).toContain("Export Excel");
    expect(markup).toContain("Import Excel");
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

  it("offers Resources, Cost Codes, Costs, EVM & DCMA, and Level Resources under Menu, for the default (owner) board", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).toContain(">Resources<");
    expect(markup).toContain(">Cost Codes<");
    expect(markup).toContain(">Costs<");
    expect(markup).toContain("EVM &amp; DCMA");
    expect(markup).toContain(">Level Resources<");
  });

  it("does not render the cost codes modal until it's opened", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-cost-accounts");
  });

  it("does not render the cycle-conflict banner on a fresh board with no cycle diagnosed yet", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-cycle-banner");
  });

  it("does not render the Import Excel status banner until an import runs", () => {
    const markup = renderToStaticMarkup(<SchedulingBoard />);
    expect(markup).not.toContain("data-scheduling-import-excel-status");
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

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

// Regression test for a real production incident: DependencyDrawer (the block-detail drawer
// opened by clicking any placed block) rendered <BlockResourcesPanel costAccounts={costAccounts} />
// without costAccounts ever being in DependencyDrawer's own props/scope, throwing
// "ReferenceError: costAccounts is not defined" on every single block click. renderToStaticMarkup
// never selects a block (nothing above ever exercises this), so this slipped past every existing
// test in this file -- this describe block renders interactively instead, places a real block via
// the same drag-and-drop drop handler the palette uses, and clicks it exactly like a user would.
// If costAccounts (or any other prop DependencyDrawer/BlockResourcesPanel expects) ever goes back
// out of scope, the thrown error propagates out of `act()` and fails this test immediately.
describe("SchedulingBoard — opening a block's drawer", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url, init) => {
      if (url === "/api/forge/scheduling/resources") return jsonResponse({ success: true, resources: [] });
      if (url === "/api/forge/scheduling/cost-accounts") return jsonResponse({ success: true, costAccounts: [] });
      if (init?.method === "PUT") return jsonResponse({ success: true }); // autosave, if its debounce fires
      return new Promise(() => {}); // the project GET (projectId is undefined here) -- never resolves, so
      // usePersistedBoard just keeps its initial local defaultBoardState() instead of racing a fabricated one in.
    });
  });

  function placeAndSelectFirstBlock(container) {
    const canvas = container.querySelector("[data-scheduling-canvas]");
    const chip = { label: "Regression Test Block", category: "gov", durationWeeks: 2, milestone: false };
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 100, clientY: 20 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => JSON.stringify(chip) } });
    act(() => { canvas.dispatchEvent(dropEvent); });

    const block = container.querySelector("[data-block-id]");
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 100, clientY: 20 });
    act(() => { block.dispatchEvent(mousedown); });
    // No mousemove dispatched -- startMoveBlock's onUp treats that as "clicked, didn't drag" (its
    // dx/dy stay at their zero default) and selects the block, exactly like a real unmoved click.
    const mouseup = new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: 100, clientY: 20 });
    act(() => { document.dispatchEvent(mouseup); });
  }

  it("opens the drawer without throwing, and renders the cost-code picker inside it", async () => {
    const mounted = mount(<SchedulingBoard />);
    await flush();

    placeAndSelectFirstBlock(mounted.container);
    await flush();

    expect(mounted.container.querySelector("[data-scheduling-drawer]")).toBeTruthy();
    expect(mounted.container.querySelector("[data-scheduling-resources-panel]")).toBeTruthy();
    expect(mounted.container.querySelector("[data-scheduling-assignment-cost-account]")).toBeTruthy();
    unmount(mounted);
  });
});
