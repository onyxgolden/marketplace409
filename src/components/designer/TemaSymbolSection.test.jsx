// @vitest-environment jsdom

// TemaSymbolSection — the inspector's TEMA picker, drawing-mode toggle,
// size inputs and replace-with-detailed button.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { TEMA_PRESETS } from "@/domains/roomDesigner/temaTypes";
import "@/domains/roomDesigner/processEquipmentCatalog";
import TemaSymbolSection from "./TemaSymbolSection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const D = "processEquipment";
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

const instanceOf = (symbolId, extra = {}) => ({ id: "s1", domain: D, symbolId, x: 0, y: 0, rotationDeg: 0, layer: "equipment", ...extra });
function mount(symbolId, extra = {}) {
  const dispatch = vi.fn();
  act(() => root.render(<TemaSymbolSection symbol={findSymbol(D, symbolId)} instance={instanceOf(symbolId, extra)} dispatch={dispatch} />));
  return dispatch;
}
const q = (sel) => container.querySelector(sel);
const byLabel = (label) => container.querySelector(`[aria-label="${label}"]`);
function choose(select, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttonNamed = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

describe("TemaSymbolSection", () => {
  it("renders nothing for symbols without TEMA drawings or a detailed version", () => {
    mount("centrifugal-pump");
    expect(container.innerHTML).toBe("");
  });

  it("offers replace-with-detailed on the simple shell-and-tube symbol", () => {
    const dispatch = mount("shell-tube-exchanger");
    click(buttonNamed("Replace with detailed version"));
    expect(dispatch).toHaveBeenCalledWith({ type: "REPLACE_WITH_DETAILED", symbolId: "s1" });
    expect(container.textContent).toMatch(/keeps position, rotation, size, tag and layer/i);
  });

  it("shows the three-part picker with the saved configuration and a live preview", () => {
    mount("tema-exchanger", { tema: { ...TEMA_PRESETS.AES } });
    expect(byLabel("Front head").value).toBe("A");
    expect(byLabel("Shell").value).toBe("E");
    expect(byLabel("Rear head").value).toBe("S");
    expect(byLabel("Tube passes").value).toBe("2");
    expect(byLabel("Front head").options).toHaveLength(5);
    expect(byLabel("Shell").options).toHaveLength(7);
    expect(byLabel("Rear head").options).toHaveLength(8);
    expect(q('[data-testid="tema-preview"] [aria-label^="TEMA AES"]')).toBeTruthy();
    choose(byLabel("Rear head"), "U");
    expect(q('[data-testid="tema-preview"] [aria-label^="TEMA AEU"]')).toBeTruthy();
    expect(q('[data-testid="tema-designation"]').textContent).toContain("AEU");
  });

  it("applies a preset through SET_SYMBOL_TEMA", () => {
    const dispatch = mount("tema-exchanger", { tema: { ...TEMA_PRESETS.AES } });
    click(buttonNamed("BEU"));
    click(buttonNamed("Apply"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_SYMBOL_TEMA", symbolId: "s1", config: { ...TEMA_PRESETS.BEU } });
  });

  it("blocks invalid combinations with the reason and disables Apply", () => {
    const dispatch = mount("tema-exchanger", { tema: { ...TEMA_PRESETS.BEU } });
    choose(byLabel("Tube passes"), "1");
    expect(q('[role="alert"]').textContent).toMatch(/even number of tube passes/);
    expect(buttonNamed("Apply").disabled).toBe(true);
    click(buttonNamed("Apply"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("warns on unusual combinations but still allows them", () => {
    const dispatch = mount("tema-exchanger", { tema: { ...TEMA_PRESETS.AES } });
    choose(byLabel("Front head"), "N");
    expect(q('[data-testid="tema-warnings"]').textContent).toMatch(/unusual/);
    expect(buttonNamed("Apply").disabled).toBe(false);
    click(buttonNamed("Apply"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_SYMBOL_TEMA", symbolId: "s1", config: { front: "N", shell: "E", rear: "S", tubePasses: 2 } });
  });

  it("toggles between the detailed drawing and the P&ID symbol", () => {
    const dispatch = mount("tema-exchanger", { tema: { ...TEMA_PRESETS.AES } });
    expect(buttonNamed("Detailed").getAttribute("aria-pressed")).toBe("true");
    click(buttonNamed("P&ID"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_SYMBOL_DRAWING_MODE", symbolId: "s1", mode: "pid" });
  });

  it("commits size edits on blur and ignores bad input", () => {
    const dispatch = mount("tema-exchanger", { tema: { ...TEMA_PRESETS.AES } });
    const length = byLabel("Length (in)");
    expect(length.value).toBe("192");
    type(length, "240");
    act(() => length.dispatchEvent(new FocusEvent("blur", { bubbles: false })));
    act(() => length.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_SYMBOL_SIZE", symbolId: "s1", widthIn: 240 });
    dispatch.mockClear();
    const depth = byLabel("Diameter envelope (in)");
    type(depth, "-3");
    act(() => depth.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("gives a component shape the mode toggle and size, but no picker", () => {
    mount("tema-rear-u");
    expect(byLabel("Front head")).toBeNull();
    expect(buttonNamed("P&ID")).toBeTruthy();
    expect(byLabel("Length (in)").value).toBe("18");
  });
});
