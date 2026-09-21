// @vitest-environment jsdom

// Printable sheets on the canvas: clicking a frame edge selects the sheet
// (interior clicks pass through to content), and dragging the frame
// dispatches a coalesced MOVE_SHEET.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import {
  addSheet,
  addWall,
  createEmptyDesign,
} from "@/domains/roomDesigner/designerDocument";

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });

function pointer(target, type, plan) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    );
  });
}

function designWithSheet() {
  let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 200, y: 100 });
  design = addSheet(design, "letter", "portrait", { x: -20, y: -20 });
  return design;
}

describe("PlanCanvas printable sheets", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design, selection = null) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="select" selection={selection} dispatch={dispatch} />
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the sheet frame with its size label", () => {
    const design = designWithSheet();
    renderCanvas(design);
    const labels = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels.some((t) => t.includes("Letter") && t.includes("portrait"))).toBe(true);
  });

  it("clicking a frame edge selects the sheet", () => {
    const design = designWithSheet();
    const sheet = design.sheets[0];
    renderCanvas(design);
    // Click the midpoint of the top edge of the frame.
    pointer(svg, "pointerdown", { x: sheet.x + sheet.planWidthIn / 2, y: sheet.y });
    pointer(svg, "pointerup", { x: sheet.x + sheet.planWidthIn / 2, y: sheet.y });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "sheet", id: sheet.id },
    });
  });

  it("interior clicks pass through the frame to the content (walls win)", () => {
    const design = designWithSheet();
    renderCanvas(design);
    // Click on the wall inside the frame — the wall must win, not the sheet.
    pointer(svg, "pointerdown", { x: 100, y: 50 });
    pointer(svg, "pointerup", { x: 100, y: 50 });
    const selects = dispatch.mock.calls.filter((c) => c[0].type === "SELECT");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0][0].selection).toEqual({ kind: "wall", id: design.walls[0].id });
  });

  it("dragging a frame edge dispatches a coalesced MOVE_SHEET", () => {
    const design = designWithSheet();
    const sheet = design.sheets[0];
    renderCanvas(design);
    const edgeMid = { x: sheet.x + sheet.planWidthIn / 2, y: sheet.y };
    pointer(svg, "pointerdown", edgeMid);
    pointer(svg, "pointermove", { x: edgeMid.x + 32, y: edgeMid.y + 16 });
    pointer(svg, "pointerup", { x: edgeMid.x + 32, y: edgeMid.y + 16 });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_SHEET");
    expect(moves.length).toBeGreaterThan(0);
    // The drag preserves the grab offset, so the anchor moved with the plan
    // point; every move of one drag shares a coalesce key.
    const keys = new Set(moves.map((c) => c[0].coalesce));
    expect(keys).toEqual(new Set([`move-sheet:${sheet.id}`]));
    const last = moves[moves.length - 1][0];
    expect(last.x).toBeCloseTo(sheet.x + 32, 6);
    expect(last.y).toBeCloseTo(sheet.y + 16, 6);
  });
});
