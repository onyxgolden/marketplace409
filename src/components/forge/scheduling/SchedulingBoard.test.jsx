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
});
