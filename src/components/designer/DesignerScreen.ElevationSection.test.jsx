// @vitest-environment jsdom

// ElevationSection: the HOME DESIGNER slice 5 elevation viewer.
//
// Contract: read-only orthographic view of the plan geometry with a
// direction picker (N/S/E/W) and, on multi-level projects, a current-level
// / all-stacked scope toggle. Missing verticals surface as a "Partial view"
// badge with the assumptions vocabulary; an empty plan promises a wall
// drawing prompt, never a blank box; "Print elevation" on a dirty project
// shows the unsaved-changes warning (print current / save and print /
// cancel) without blocking printing; a damaged project renders a status
// line, never a crash.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { ElevationSection } from "./DesignerScreen";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "@/domains/roomDesigner/homeProject";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import "@/domains/roomDesigner/pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

afterEach(() => {});

function cabinDesign() {
  let d = createEmptyDesign("Cabin");
  d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
  d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
  d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
  d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
  return d;
}

function cabinProject() {
  let p = createHomeProject("Cabin project", { units: "ft" });
  p = updateLevelDesign(p, p.levels[0].id, () => cabinDesign());
  return p;
}

function twoLevelProject() {
  let p = createHomeProject("Two story", { units: "ft" });
  p = updateLevelDesign(p, p.levels[0].id, () => cabinDesign());
  p = addLevel(p);
  const secondId = p.levels[p.levels.length - 1].id;
  p = updateLevelDesign(p, secondId, () => cabinDesign());
  return p;
}

describe("ElevationSection", () => {
  let container;
  let root;

  const renderSection = (props) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <ElevationSection
          project={null}
          design={null}
          dirty={false}
          onPrintElevation={() => {}}
          onSaveAndPrintElevation={() => {}}
          {...props}
        />,
      );
    });
    return container;
  };

  const rerender = (props) => {
    act(() => {
      root.render(
        <ElevationSection
          project={null}
          design={null}
          dirty={false}
          onPrintElevation={() => {}}
          onSaveAndPrintElevation={() => {}}
          {...props}
        />,
      );
    });
    return container;
  };

  const clickText = (text) => {
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    expect(button, `button "${text}"`).toBeTruthy();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders nothing without a project", () => {
    const el = renderSection({});
    expect(el.textContent).toBe("");
  });

  it("labels the viewer Elevations and defers Sections honestly", () => {
    const p = cabinProject();
    const el = renderSection({ project: p, design: cabinDesign() });
    expect(el.textContent).toMatch(/Elevations/);
    expect(el.textContent).toMatch(/Sections \(coming later\)/);
  });

  it("switches direction on N/S/E/W buttons", () => {
    const p = cabinProject();
    const el = renderSection({ project: p, design: cabinDesign() });
    const svg = () => el.querySelector('[data-testid="elevation-svg-panel"]');
    expect(svg().getAttribute("aria-label")).toMatch(/looking south/);
    clickText("S");
    expect(svg().getAttribute("aria-label")).toMatch(/looking north/);
    clickText("E");
    expect(svg().getAttribute("aria-label")).toMatch(/looking west/);
  });

  it("shows the scope toggle only on multi-level projects", () => {
    const single = renderSection({
      project: cabinProject(),
      design: cabinDesign(),
    });
    expect(single.textContent).not.toMatch(/All levels stacked/);

    rerender({ project: twoLevelProject(), design: cabinDesign() });
    expect(container.textContent).toMatch(/All levels stacked/);
    // Single-level view names only the current level; stacked names both.
    expect(container.textContent).not.toMatch(/Level 2/);
    clickText("All levels stacked");
    expect(container.textContent).toMatch(/Level 2/);
  });

  it("prompts to draw walls when the plan is empty", () => {
    const p = cabinProject();
    const empty = createEmptyDesign("Empty");
    const el = renderSection({ project: p, design: empty });
    expect(el.textContent).toMatch(/Draw walls on the plan/);
  });

  it("shows the Partial view badge when verticals are defaulted", () => {
    const p = cabinProject();
    const noSettings = { ...cabinDesign(), settings: {} };
    const el = renderSection({ project: p, design: noSettings });
    expect(el.textContent).toMatch(/Partial view/);
    expect(el.textContent).toMatch(/Default wall height/);
  });

  it("renders openings as cut-outs, not added geometry", () => {
    let d = cabinDesign();
    d = addOpening(d, "south", { type: "window", offsetIn: 12, widthIn: 36 });
    const p = cabinProject();
    const el = renderSection({ project: p, design: d });
    const rects = el.querySelectorAll('[data-testid="elevation-svg-panel"] rect');
    // N view: south + north walls render as rects; east + west walls are
    // perpendicular and render as edge lines. One window cut-out rect.
    expect(rects.length).toBe(3);
    const cutOuts = [...rects].filter((r) => r.getAttribute("fill") === "#0b0f14");
    expect(cutOuts.length).toBe(1);
  });

  it("warns on dirty print but never blocks printing", () => {
    const onPrintElevation = vi.fn();
    const p = cabinProject();
    const el = renderSection({
      project: p,
      design: cabinDesign(),
      dirty: true,
      onPrintElevation,
    });
    clickText("Print elevation");
    expect(el.textContent).toMatch(/Unsaved changes/);
    // Cancel closes the dialog without printing.
    clickText("Cancel");
    expect(el.textContent).not.toMatch(/Unsaved changes/);
    expect(onPrintElevation).not.toHaveBeenCalled();
    // Print current version prints the live view.
    clickText("Print elevation");
    clickText("Print current version");
    expect(onPrintElevation).toHaveBeenCalledTimes(1);
  });

  it("calls save-and-print with the current direction and scope", () => {
    const onSaveAndPrintElevation = vi.fn();
    const p = twoLevelProject();
    const el = renderSection({
      project: p,
      design: cabinDesign(),
      dirty: true,
      onSaveAndPrintElevation,
    });
    clickText("All levels stacked");
    clickText("Print elevation");
    expect(el.textContent).toMatch(/Unsaved changes/);
    clickText("Save and print");
    expect(onSaveAndPrintElevation).toHaveBeenCalledWith("N", "stacked");
  });

  it("renders a status line instead of crashing on a damaged project", () => {
    const p = { ...cabinProject(), name: "" };
    const el = renderSection({ project: p, design: cabinDesign() });
    expect(el.textContent).toMatch(/Elevation unavailable/);
  });
});
