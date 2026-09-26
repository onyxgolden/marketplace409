// @vitest-environment jsdom

// FurnitureSizeEditor — custom W/D/H for any piece; standard sizes and
// mounting height for cabinets.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDesign, placeFurniture, resizeFurniture } from "@/domains/roomDesigner/designerDocument";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { createInitialState, designerReducer } from "./designerReducer";
import FurnitureSizeEditor from "./FurnitureSizeEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const pieceOf = (catalogId, edit = (d) => d) => {
  const d = edit(placeFurniture(createEmptyDesign(), catalogId, 0, 0));
  return d.furniture[0];
};
function render(piece) {
  const dispatch = vi.fn();
  act(() => root.render(<FurnitureSizeEditor piece={piece} entry={getCatalogEntry(piece.catalogId)} dispatch={dispatch} />));
  return dispatch;
}
const q = (label) => container.querySelector(`[aria-label="${label}"]`);
function change(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

describe("FurnitureSizeEditor", () => {
  it("gives ordinary furniture custom width, depth and height, no standard picks", () => {
    const dispatch = render(pieceOf("sofa-3seat"));
    expect(q("Standard width")).toBeNull();
    expect(container.textContent).toContain("84″ × 36″ × 34″");
    change(q("Height"), 30);
    expect(dispatch).toHaveBeenCalledWith({ type: "RESIZE_FURNITURE", furnitureId: expect.any(String), widthIn: 84, depthIn: 36, heightIn: 30 });
  });

  it("offers a cabinet's standard sizes and applies a pick", () => {
    const dispatch = render(pieceOf("cabinet-base-24"));
    const widths = [...q("Standard width").options].map((o) => o.textContent);
    expect(widths).toContain("9″");
    expect(widths).toContain("48″");
    change(q("Standard width"), 36);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "RESIZE_FURNITURE", widthIn: 36, depthIn: 24, heightIn: 34 }));
    expect(q("Mounting height")).toBeNull(); // base cabinets stand on the floor
  });

  it("shows a non-standard size as Custom", () => {
    render(pieceOf("cabinet-base-24", (d) => resizeFurniture(d, d.furniture[0].id, 25.5, 24, 34)));
    expect(q("Standard width").value).toBe("custom");
    expect(q("Standard width").options[0].textContent).toBe("Custom (25.5″)");
  });

  it("gives wall cabinets a mounting height with standard picks", () => {
    const dispatch = render(pieceOf("cabinet-wall-24"));
    expect(q("Mounting height").value).toBe("54");
    change(q("Standard mount"), 60);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_FURNITURE_MOUNT", furnitureId: expect.any(String), mountIn: 60 });
  });

  it("ignores out-of-range typing instead of dispatching it", () => {
    const dispatch = render(pieceOf("desk"));
    change(q("Height"), 0);
    change(q("Width"), 900);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("offers a full reset once any size is overridden", () => {
    render(pieceOf("desk"));
    expect(container.textContent).not.toContain("Reset to catalog size");
    act(() => root.unmount());
    root = createRoot(container);
    const dispatch = render(pieceOf("desk", (d) => resizeFurniture(d, d.furniture[0].id, 60, 30, 29)));
    const reset = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Reset to catalog size"));
    expect(reset.textContent).toContain("48″ × 24″ × 30″");
    act(() => reset.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "RESET_FURNITURE_SIZE", furnitureId: expect.any(String) });
  });
});

describe("reducer", () => {
  it("SET_FURNITURE_MOUNT is one undo step", () => {
    let state = createInitialState(placeFurniture(createEmptyDesign(), "cabinet-wall-24", 0, 0));
    const id = state.design.furniture[0].id;
    state = designerReducer(state, { type: "SET_FURNITURE_MOUNT", furnitureId: id, mountIn: 66 });
    expect(state.design.furniture[0].mountIn).toBe(66);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.furniture[0].mountIn).toBeUndefined();
  });
});

describe("reducer — saved estimates", () => {
  it("SAVE_CABINET_ESTIMATE / DELETE_CABINET_ESTIMATE edit design.cabinetEstimates as undoable steps", () => {
    let state = createInitialState(createEmptyDesign());
    state = designerReducer(state, { type: "SAVE_CABINET_ESTIMATE", snapshot: { id: "e1", totalCents: 1 } });
    expect(state.design.cabinetEstimates.map((s) => s.id)).toEqual(["e1"]);
    state = designerReducer(state, { type: "DELETE_CABINET_ESTIMATE", snapshotId: "e1" });
    expect(state.design.cabinetEstimates).toEqual([]);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.cabinetEstimates.map((s) => s.id)).toEqual(["e1"]);
  });
});
