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
    expect(markup.match(/sticky top-0 z-\[4\]/g)?.length).toBe(53);
  });
});
