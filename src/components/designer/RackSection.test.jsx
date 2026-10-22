// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RackSection from "./RackSection";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import "@/domains/roomDesigner/processEquipmentCatalog";

let container;
let root;
let dispatch;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  dispatch = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function setValue(el, v) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  act(() => el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })));
}
const blur = (el) => act(() => el.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })));
const render = (symbolId, inst = {}) =>
  act(() => root.render(<RackSection symbol={findSymbol("processEquipment", symbolId)} instance={{ id: "r1", ...inst }} dispatch={dispatch} />));
const field = (label) => container.querySelector(`[aria-label="${label}"]`);

describe("RackSection", () => {
  it("shows the pipe rack in feet and commits a new top-of-steel elevation in inches", () => {
    render("pipe-rack");
    expect(field("Top of steel, tier 1").value).toBe("15");
    setValue(field("Top of steel, tier 1"), "20");
    blur(field("Top of steel, tier 1"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_RACK_PARAMS", symbolId: "r1", fields: { elevationIn: 240 } });
    expect(container.textContent).toMatch(/overall 21' 0" high/);
  });

  it("changes tiers, length (symbol size) and refuses out-of-range entries", () => {
    render("pipe-rack");
    setValue(field("Tiers"), "3");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_RACK_PARAMS", symbolId: "r1", fields: { tiers: 3 } });
    setValue(field("Length"), "80");
    blur(field("Length"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_SYMBOL_SIZE", symbolId: "r1", widthIn: 960 });
    dispatch.mockClear();
    setValue(field("Top of steel, tier 1"), "2");
    expect(container.textContent).toMatch(/7–60 ft/);
    blur(field("Top of steel, tier 1"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sleeper rack: no tiers, sleeper wording", () => {
    render("sleeper-rack");
    expect(field("Tiers")).toBeNull();
    expect(field("Top of sleeper").value).toBe("1.5");
    expect(container.textContent).toMatch(/SLEEPERS · TOS EL 1' 6"/);
  });

  it("renders nothing for a non-rack", () => {
    render("centrifugal-pump");
    expect(container.innerHTML).toBe("");
  });
});
