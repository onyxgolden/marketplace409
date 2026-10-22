// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SystemMembershipSection, SystemsSection } from "./SystemsPanels";
import { addPipeRun, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { addSystem, setMemberColor, setMemberSystem } from "@/domains/roomDesigner/designSystems";

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
const render = (el) => act(() => root.render(el));
const q = (sel) => container.querySelector(sel);
// React tracks input values; set through the native setter so onChange fires.
function type(el, value) {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  act(() => el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })));
}
const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));

function design() {
  let d = addPipeRun(createEmptyDesign("S"), [{ x: 0, y: 0 }, { x: 60, y: 0 }], { id: "l1" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 100, 0, { id: "p1" });
  return addSystem(d, { name: "Steam", color: "#ef4444" });
}

describe("SystemsSection", () => {
  it("adds a system with a palette color, and refuses a duplicate name", () => {
    render(<SystemsSection design={design()} dispatch={dispatch} />);
    const name = q('[aria-label="New system name"]');
    type(name, "steam");
    expect(container.textContent).toMatch(/already exists/);
    expect(q('form[aria-label="New system"] button[type="submit"]').disabled).toBe(true);
    type(name, "Cooling water");
    act(() => q('form[aria-label="New system"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_SYSTEM", name: "Cooling water", color: "#22c55e" });
  });

  it("recolors (coalesced) and deletes a system", () => {
    render(<SystemsSection design={design()} dispatch={dispatch} />);
    type(q('[aria-label="Color of Steam"]'), "#f59e0b");
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SYSTEM", systemId: "system_1", fields: { color: "#f59e0b" }, coalesce: "system-color:system_1" });
    click(q('[aria-label="Delete system Steam"]'));
    expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_SYSTEM", systemId: "system_1" });
  });
});

describe("SystemMembershipSection", () => {
  it("assigns a system, and '+ New system…' creates and assigns in one action", () => {
    const d = design();
    render(<SystemMembershipSection design={d} kind="symbol" member={d.symbols[0]} fallbackColor="#60a5fa" dispatch={dispatch} />);
    const select = q("select");
    type(select, "system_1");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_MEMBER_SYSTEM", target: { kind: "symbol", id: "p1" }, systemId: "system_1" });
    type(select, "__new");
    type(q('[aria-label="New system name"]'), "Cooling water");
    act(() => q('form[aria-label="New system"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_SYSTEM", name: "Cooling water", assignTo: { kind: "symbol", id: "p1" } }));
  });

  it("shows where the color comes from, sets an own color, and resets it", () => {
    let d = setMemberSystem(design(), { kind: "symbol", id: "p1" }, "system_1");
    render(<SystemMembershipSection design={d} kind="symbol" member={d.symbols[0]} fallbackColor="#60a5fa" dispatch={dispatch} />);
    expect(q('[aria-label="Item color"]').value).toBe("#ef4444");
    expect(container.textContent).toMatch(/from system/);
    type(q('[aria-label="Item color"]'), "#a855f7");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "p1" }, color: "#a855f7", coalesce: "color:p1" });
    d = setMemberColor(d, { kind: "symbol", id: "p1" }, "#a855f7");
    render(<SystemMembershipSection design={d} kind="symbol" member={d.symbols[0]} fallbackColor="#60a5fa" dispatch={dispatch} />);
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reset"));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "p1" }, color: null });
  });

  it("pipes (only) get the Underground checkbox", () => {
    const d = design();
    render(<SystemMembershipSection design={d} kind="pipe" member={d.pipes[0]} fallbackColor="#7dd3fc" dispatch={dispatch} />);
    click(q('input[type="checkbox"]'));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_PIPE_UNDERGROUND", pipeId: "l1", underground: true });
    render(<SystemMembershipSection design={d} kind="symbol" member={d.symbols[0]} fallbackColor="#60a5fa" dispatch={dispatch} />);
    expect(q('input[type="checkbox"]')).toBeNull();
  });
});
