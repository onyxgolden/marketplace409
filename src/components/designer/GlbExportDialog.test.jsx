// @vitest-environment jsdom

// GlbExportDialog: FORGE Room Designer .glb export UI (Phase 1).
//
// Contract: Floor and Furniture are included by default; Download passes the
// CURRENT LEVEL'S DESIGN (with unsaved edits merged in) to exportDesignToGlb —
// never the whole project. Regression: the dialog once passed the project
// object straight through, and every export failed validation with
// "Not a room-designer document." A failed export shows the message in the
// dialog; it never throws.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/domains/roomDesigner/designerGlbModel", () => ({
  exportDesignToGlb: vi.fn(async () => ({ ok: true, glb: new ArrayBuffer(8), stats: {} })),
  glbFileName: (name) => `${name || "design"}.glb`,
}));

import GlbExportDialog from "./GlbExportDialog";
import { exportDesignToGlb } from "@/domains/roomDesigner/designerGlbModel";
import {
  addLevel,
  createHomeProject,
  resetHomeProjectIds,
} from "@/domains/roomDesigner/homeProject";
import {
  addWall,
  createEmptyDesign,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
  vi.clearAllMocks();
});

let root = null;
let container = null;

function twoLevelProject() {
  let project = createHomeProject("Cabin project", { levelName: "Ground" });
  const d1 = addWall(createEmptyDesign("Ground"), { x: 0, y: 0 }, { x: 100, y: 0 });
  const d2 = addWall(createEmptyDesign("Upper"), { x: 0, y: 0 }, { x: 80, y: 0 });
  project = {
    ...project,
    levels: [{ ...project.levels[0], design: d1 }],
  };
  project = addLevel(project, "Upper");
  const upper = project.levels[1];
  return {
    ...project,
    levels: [project.levels[0], { ...upper, design: d2 }],
  };
}

function renderDialog(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(GlbExportDialog, props));
  });
  return document.body;
}

function downloadButton(body) {
  return [...body.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Download GLB"),
  );
}

function stubDownload() {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake-glb"),
    revokeObjectURL: vi.fn(),
  });
  const clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicked.push({ href: this.href, download: this.download });
  });
  return clicked;
}

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  vi.restoreAllMocks();
});

describe("GlbExportDialog", () => {
  it("includes Floor and Furniture by default", () => {
    const project = twoLevelProject();
    const body = renderDialog({
      project,
      design: project.levels[0].design,
      onClose: () => {},
    });
    const labels = [...body.querySelectorAll("label")];
    const floor = labels.find((l) => l.textContent.includes("Floor"));
    const furniture = labels.find((l) => l.textContent.includes("Furniture"));
    expect(floor.querySelector('input[type="checkbox"]').checked).toBe(true);
    expect(furniture.querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it("passes the current level design — not the project — to exportDesignToGlb", async () => {
    const project = twoLevelProject();
    const clicked = stubDownload();
    const body = renderDialog({
      project,
      design: project.levels[0].design,
      onClose: () => {},
    });
    await act(async () => {
      downloadButton(body).click();
    });

    expect(exportDesignToGlb).toHaveBeenCalledTimes(1);
    const doc = exportDesignToGlb.mock.calls[0][0];
    // A project has levels; a design has walls. The export must get a design.
    expect(doc.levels).toBeUndefined();
    expect(Array.isArray(doc.walls)).toBe(true);
    expect(doc.walls.length).toBe(1);
    expect(doc.walls[0].b.x).toBe(100);
    expect(clicked.length).toBe(1);
    expect(clicked[0].download).toBe("Cabin project.glb");
  });

  it("exports the edited on-screen design, not just the saved project", async () => {
    const project = twoLevelProject();
    stubDownload();
    // Simulate an unsaved edit: the on-screen design has a longer wall.
    const edited = addWall(createEmptyDesign("Ground"), { x: 0, y: 0 }, { x: 200, y: 0 });
    const body = renderDialog({ project, design: edited, onClose: () => {} });
    await act(async () => {
      downloadButton(body).click();
    });

    expect(exportDesignToGlb).toHaveBeenCalledTimes(1);
    const doc = exportDesignToGlb.mock.calls[0][0];
    expect(Array.isArray(doc.walls)).toBe(true);
    expect(doc.walls[0].b.x).toBe(200);
  });

  it("shows the export error in the dialog instead of crashing", async () => {
    const project = twoLevelProject();
    stubDownload();
    exportDesignToGlb.mockResolvedValueOnce({
      ok: false,
      error: "Nothing to export — add walls or furniture first.",
    });
    const body = renderDialog({
      project,
      design: createEmptyDesign("Ground"),
      onClose: () => {},
    });
    await act(async () => {
      downloadButton(body).click();
    });

    expect(body.textContent).toContain("Nothing to export");
  });
});
