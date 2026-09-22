// @vitest-environment jsdom

// MeasurementsSection: the HOME DESIGNER slice 3 measurements readout.
//
// Contract: project-wide quantities derived purely from Room Designer
// geometry — per-level rows plus project totals. A damaged project renders
// a status line, never a crash. The readout respects the project's units.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { MeasurementsSection } from "./DesignerScreen";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "@/domains/roomDesigner/homeProject";
import {
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import "@/domains/roomDesigner/pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function bedroomDesign() {
  let d = createEmptyDesign("Bedroom");
  d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 12x12 = 144 sq ft
  return d;
}

function twoLevelProject(units = "ft") {
  let p = createHomeProject("Two-story", { units });
  p = updateLevelDesign(p, p.levels[0].id, () => bedroomDesign());
  p = addLevel(p, "Level 2");
  let d2 = createEmptyDesign("Level 2");
  d2 = addRoomFromTemplate(d2, "bathroom", { x: 0, y: 0 }); // 8x6 = 48 sq ft
  p = updateLevelDesign(p, p.levels[1].id, () => d2);
  return p;
}

describe("MeasurementsSection", () => {
  let container;
  let root;

  const renderSection = (props) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<MeasurementsSection project={null} design={null} {...props} />);
    });
    return container.textContent;
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders project totals across levels", () => {
    const project = twoLevelProject();
    const text = renderSection({ project, design: project.levels[0].design });
    expect(text).toContain("Measurements · 2 levels");
    expect(text).toContain("192 sq ft"); // 144 + 48 gross
    expect(text).toContain("Level 1");
    expect(text).toContain("Level 2");
  });

  it("shows per-level rows with each level's own numbers", () => {
    const project = twoLevelProject();
    const text = renderSection({ project, design: project.levels[0].design });
    expect(text).toContain("144 sq ft");
    expect(text).toContain("48 sq ft");
  });

  it("reflects unsaved edits on screen in the totals", () => {
    const project = twoLevelProject();
    // the reducer's edited design replaces the current level's stored design
    const text = renderSection({ project, design: createEmptyDesign() });
    expect(text).toContain("48 sq ft"); // only Level 2's area remains
    expect(text).not.toContain("192 sq ft");
  });

  it("renders a status line — not a crash — on a damaged project", () => {
    const damaged = { version: 1, levels: [], currentLevelId: "x" };
    const text = renderSection({ project: damaged, design: createEmptyDesign() });
    expect(text).toContain("Measurements unavailable");
  });

  it("falls back to the single design when there is no project", () => {
    const text = renderSection({ project: null, design: bedroomDesign() });
    expect(text).toContain("Measurements");
    expect(text).toContain("144 sq ft");
    expect(text).not.toContain("levels");
  });

  it("respects metric project units", () => {
    const project = twoLevelProject("m");
    const text = renderSection({ project, design: project.levels[0].design });
    expect(text).toContain("m²");
  });

  it("renders nothing when there is no project and no design", () => {
    const text = renderSection({ project: null, design: null });
    expect(text).toBe("");
  });
});
