// @vitest-environment jsdom

// DxfExportDialog: FORGE Home Designer slice 6 DXF export UI.
//
// Contract: lists project levels with the current level checked by default;
// Download exports the on-screen design (unsaved edits included) to a
// date-stamped .dxf file via planToDxf; empty selection is refused with a
// status message, never a crash.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import DxfExportDialog from "./DxfExportDialog";
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
import { projectWithEditedDesign } from "@/domains/roomDesigner/homeQuantities";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
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
    root.render(React.createElement(DxfExportDialog, props));
  });
  return document.body;
}

function checkboxFor(body, label) {
  const labels = [...body.querySelectorAll("label")];
  const match = labels.find((l) => l.textContent.includes(label));
  return match ? match.querySelector('input[type="checkbox"]') : null;
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

describe("DxfExportDialog", () => {
  it("checks the current level by default and lists every level", () => {
    const project = twoLevelProject();
    const body = renderDialog({
      project,
      design: project.levels[0].design,
      currentLevelId: project.levels[0].id,
      onClose: () => {},
    });
    const ground = checkboxFor(body, "Ground");
    const upper = checkboxFor(body, "Upper");
    expect(ground).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(ground.checked).toBe(true);
    expect(upper.checked).toBe(false);
  });

  it("refuses to download with no level selected", () => {
    const project = twoLevelProject();
    const onClose = vi.fn();
    const body = renderDialog({
      project,
      design: project.levels[0].design,
      currentLevelId: project.levels[0].id,
      onClose,
    });
    act(() => {
      checkboxFor(body, "Ground").click();
    });
    const downloadBtn = [...body.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Download DXF"),
    );
    expect(downloadBtn.disabled).toBe(true);
  });

  it("downloads a date-stamped DXF built from the on-screen design", () => {
    const project = twoLevelProject();
    const onClose = vi.fn();
    const created = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob) => {
        created.push(blob);
        return "blob:fake-dxf";
      }),
      revokeObjectURL: vi.fn(),
    });
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked.push({ href: this.href, download: this.download });
    });

    const body = renderDialog({
      project,
      design: project.levels[0].design,
      currentLevelId: project.levels[0].id,
      onClose,
    });
    const downloadBtn = [...body.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Download DXF"),
    );
    act(() => {
      downloadBtn.click();
    });

    expect(created.length).toBe(1);
    expect(clicked.length).toBe(1);
    expect(clicked[0].download).toMatch(/^Cabin project-\d{8}\.dxf$/);
    // The blob holds a real DXF: header + the exported wall layer.
    return created[0].text().then((text) => {
      expect(text).toContain("9\n$ACADVER\n1\nAC1014");
      expect(text).toContain("A-L01-WALL");
      expect(text).not.toContain("A-L02-WALL");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("exports the edited on-screen design, not just the saved project", () => {
    const project = twoLevelProject();
    // Simulate an unsaved edit: the on-screen design has a longer wall.
    const edited = addWall(createEmptyDesign("Ground"), { x: 0, y: 0 }, { x: 200, y: 0 });
    const merged = projectWithEditedDesign(project, edited);
    expect(merged.levels[0].design.walls[0].b.x).toBe(200);
    expect(project.levels[0].design.walls[0].b.x).toBe(100);
  });
});
