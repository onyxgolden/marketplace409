// D10-04 fix round 1 (P1): the inspector must never invent a head-nozzle
// position. A new schedule entry stays position-less until the operator
// explicitly selects Top or Bottom; the selector shows a placeholder,
// not Top; validation rejects the unset position and no scheduled face
// resolves until it is supplied.
//
// Fixture geometry (horizontal-drum: 120 wide x 42 deep x 54 high,
// base 0, rotation 0, at the origin): radius 21, saddle 12,
// centerline 33, shell length 99, tangent lines at ±49.5.
//   liquid-out (west end, 6 in): top at 44 in -> face (-55.5, 0).
//   vapor-out (east end, 8 in): bottom at 22 in -> face (55.5, 0).

/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import HeadNozzleScheduleSection from "./HeadNozzleScheduleSection.jsx";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import {
  HEAD_NOZZLE_SCHEDULE_VERSION,
  headNozzleFace,
  headNozzleScheduleProblems,
} from "@/domains/roomDesigner/vesselHeadNozzles";
import {
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function choose(select, value) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

let root = null;
let container = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function setup() {
  resetDesignerIds();
  let design = createEmptyDesign("head inspector test");
  design = { ...design, headNozzleScheduleVersion: HEAD_NOZZLE_SCHEDULE_VERSION };
  design = placeSymbol(design, "processEquipment", "horizontal-drum", 0, 0, { id: "v1", tag: "V-101" });
  let inst = design.symbols.find((s) => s.id === "v1");
  const symbol = findSymbol("processEquipment", "horizontal-drum");
  const dispatched = [];
  const dispatch = (action) => {
    dispatched.push(action);
    if (action.type === "SET_HEAD_NOZZLE_SCHEDULE") {
      inst = { ...inst, headNozzleSchedule: action.schedule };
    }
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(
        React.createElement(HeadNozzleScheduleSection, { design, symbol, instance: inst, dispatch }),
      );
    });
  };
  return {
    render,
    dispatched,
    get inst() {
      return inst;
    },
    get symbol() {
      return symbol;
    },
    entry(nozzleId) {
      return (inst.headNozzleSchedule || []).find((e) => e?.id === nozzleId) || null;
    },
  };
}

function cardFor(nozzleId) {
  const span = [...container.querySelectorAll("span")].find((s) =>
    s.textContent.startsWith(`${nozzleId} ·`),
  );
  expect(span).toBeTruthy();
  return span.closest("div.rounded");
}

function controls(nozzleId) {
  const card = cardFor(nozzleId);
  const selects = [...card.querySelectorAll("select")];
  const numbers = [...card.querySelectorAll('input[type="number"]')];
  return {
    positionSelect: selects[0],
    ratingSelect: selects[1],
    sizeInput: numbers[0],
    elevationInput: numbers[1],
    projectionInput: numbers[2],
    ratingValueInput: card.querySelector('input[type="text"]'),
  };
}

async function interact(harness, fn) {
  act(() => {
    fn();
  });
  await harness.render();
}

describe("D10-04 fix round 1 — no invented head-nozzle position", () => {
  it("editing size/elevation/projection/rating before position persists no top/bottom value and resolves no face", async () => {
    const h = setup();
    await h.render();
    // The selector shows a placeholder, not Top, before anything is chosen.
    let c = controls("liquid-out");
    expect(c.positionSelect.value).toBe("");
    expect(c.positionSelect.options[c.positionSelect.selectedIndex].text).toBe("Select position");

    // The operator authors everything except the position.
    await interact(h, () => enter(controls("liquid-out").sizeInput, "6"));
    await interact(h, () => enter(controls("liquid-out").elevationInput, "44"));
    await interact(h, () => enter(controls("liquid-out").projectionInput, "6"));
    await interact(h, () => choose(controls("liquid-out").ratingSelect, "rated"));
    await interact(h, () => enter(controls("liquid-out").ratingValueInput, "150"));

    // No top/bottom value was persisted anywhere in the entry.
    const entry = h.entry("liquid-out");
    expect(entry).not.toBeNull();
    expect("position" in entry).toBe(false);
    expect(entry.position).toBeUndefined();
    expect(JSON.stringify(entry)).not.toMatch(/top|bottom/);
    // Surface and orientation stay derived from the catalog end identity.
    expect(entry.surface).toBe("head-west");
    expect(entry.orientationDeg).toBe(180);
    // Validation rejects the unset position and no scheduled face resolves.
    expect(headNozzleScheduleProblems(h.symbol, h.inst).join("\n")).toMatch(
      /liquid-out.*position is missing/,
    );
    expect(headNozzleFace(h.symbol, h.inst, "liquid-out")).toBe(null);
    // The selector still shows the placeholder after the other edits.
    c = controls("liquid-out");
    expect(c.positionSelect.value).toBe("");
    expect(c.positionSelect.options[c.positionSelect.selectedIndex].text).toBe("Select position");
  });

  it("explicit Top resolves the scheduled face", async () => {
    const h = setup();
    await h.render();
    await interact(h, () => enter(controls("liquid-out").sizeInput, "6"));
    await interact(h, () => enter(controls("liquid-out").elevationInput, "44"));
    await interact(h, () => enter(controls("liquid-out").projectionInput, "6"));
    // Still unresolved before the position is chosen.
    expect(h.entry("liquid-out").position).toBeUndefined();
    expect(headNozzleFace(h.symbol, h.inst, "liquid-out")).toBe(null);
    await interact(h, () => choose(controls("liquid-out").positionSelect, "top"));
    expect(h.entry("liquid-out").position).toBe("top");
    expect(headNozzleScheduleProblems(h.symbol, h.inst)).toEqual([]);
    expect(headNozzleFace(h.symbol, h.inst, "liquid-out")).toMatchObject({
      anchorId: "liquid-out",
      x: -55.5,
      y: 0,
      elevationIn: 44,
      normal: { x: -1, y: 0 },
      sizeIn: 6,
      kind: "head",
    });
  });

  it("explicit Bottom resolves the scheduled face on the opposite head", async () => {
    const h = setup();
    await h.render();
    await interact(h, () => enter(controls("vapor-out").sizeInput, "8"));
    await interact(h, () => enter(controls("vapor-out").elevationInput, "22"));
    await interact(h, () => enter(controls("vapor-out").projectionInput, "6"));
    // Still unresolved before the position is chosen.
    expect(h.entry("vapor-out").position).toBeUndefined();
    expect(headNozzleFace(h.symbol, h.inst, "vapor-out")).toBe(null);
    await interact(h, () => choose(controls("vapor-out").positionSelect, "bottom"));
    expect(h.entry("vapor-out").position).toBe("bottom");
    expect(headNozzleFace(h.symbol, h.inst, "vapor-out")).toMatchObject({
      anchorId: "vapor-out",
      x: 55.5,
      y: 0,
      elevationIn: 22,
      normal: { x: 1, y: 0 },
      sizeIn: 8,
      kind: "head",
    });
  });
});
