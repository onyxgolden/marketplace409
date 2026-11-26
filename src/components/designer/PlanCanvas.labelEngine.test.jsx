// @vitest-environment jsdom

// Plot-plan label layout engine (component coverage): PlanCanvas on the
// REAL FCCU fixture at phone width renders the engine's ranked,
// deconflicted labels instead of the routines' own in-glyph text.
// jsdom has no layout engine, so this asserts counts/presence and the
// Find dispatch; the Playwright geometry check measures real getBBox
// rects in Chromium and asserts zero intersections at every width.
//
// jsdom measures text with the conservative estimator (0.62em/char —
// wider than Chromium's ~0.45-0.5em), so jsdom withholds slightly more
// than the browser; the thresholds below (≥10 of 14 Tier 1 at fit) hold
// under both.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import fccuDesign from "../../../public/phone-fixture/fccu-design-snapshot.json";
import { dimensionGeometry } from "@/domains/roomDesigner/designerGeometry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TIER_1 = [
  "R-101",
  "R-102",
  "T-101",
  "T-102",
  "E-101",
  "E-102",
  "E-103",
  "E-104",
  "K-101",
  "K-102",
  "V-101",
  "V-102",
  "P-101",
  "FL-101",
];
const TIER_2 = ["P-102", "P-103", "P-104", "P-105", "P-106", "PR-101", "SL-101"];

// Same size-stub harness as PlanCanvas.phoneLabels.test.jsx: PlanCanvas
// measures its wrapper via clientWidth/clientHeight (read once in an
// effect) and a ResizeObserver callback; jsdom reports 0 for both.
let mockSize = { w: 0, h: 0 };
window.ResizeObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
const widthDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientWidth");
const heightDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientHeight");
Object.defineProperty(window.Element.prototype, "clientWidth", {
  configurable: true,
  get() {
    return mockSize.w;
  },
});
Object.defineProperty(window.Element.prototype, "clientHeight", {
  configurable: true,
  get() {
    return mockSize.h;
  },
});
afterAll(() => {
  if (widthDesc) Object.defineProperty(window.Element.prototype, "clientWidth", widthDesc);
  else delete window.Element.prototype.clientWidth;
  if (heightDesc) Object.defineProperty(window.Element.prototype, "clientHeight", heightDesc);
  else delete window.Element.prototype.clientHeight;
});

const textsByKind = (container, kind) =>
  [...container.querySelectorAll(`text[data-label-kind="${kind}"]`)].map((t) => t.textContent);
const engineTags = (container) =>
  [...container.querySelectorAll('text[data-label-kind="equipment-tag"]')];

// Open the Hidden labels disclosure the way a user does (click the
// summary — the browser owns the open state). If jsdom ever does not
// toggle on the click, set it directly, the way Close/Find/Escape do.
const openHiddenLabels = (details) => {
  const summary = details.querySelector("summary");
  act(() => {
    summary.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  if (!details.open) {
    act(() => {
      details.open = true;
    });
  }
  expect(details.open).toBe(true);
};

// The first hidden row for a selectable source (symbol/pipe/room):
// annotations have no selection kind, so a Find test that asserts a
// SELECT must not pick an annotation row.
const firstSelectableRow = (details) =>
  [...details.querySelectorAll("li")].find((li) =>
    [...TIER_1, ...TIER_2].some((tag) => li.textContent.includes(tag)),
  );

describe("PlanCanvas label layout engine", () => {
  let container;
  let root;
  let dispatch;

  const renderCanvas = (props = {}) => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      dispatch = vi.fn();
    }
    act(() => {
      root.render(
        <PlanCanvas
          design={fccuDesign}
          tool="select"
          selection={null}
          dispatch={dispatch}
          autoFitKey="fccu-fixture:level_1"
          labelSourceProjectId="design_mwjvt635_lmexii"
          {...props}
        />,
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = null;
    container?.remove();
    container = null;
    mockSize = { w: 0, h: 0 };
  });

  it("renders Tier 1 equipment tags at fit and withholds at most four", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const tags = engineTags(container);
    const shown = tags.map((t) => t.textContent);
    const tier1Shown = TIER_1.filter((tag) => shown.includes(tag));
    // jsdom measures with the conservative estimator (0.62em/char —
    // wider than Chromium's ~0.45-0.5em), so it withholds slightly more
    // than the browser; 10 of 14 here, and the geometry guard enforces
    // the brief's rule (no more than four Tier 1 withheld) in Chromium
    // at 390/400, where the real widths apply.
    expect(tier1Shown.length).toBeGreaterThanOrEqual(10);
    // Tier 1 renders at 13px, never smaller — the 11px overview tags
    // are gone; the engine owns every equipment tag at fit.
    for (const t of tags) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(12);
      expect(t.getAttribute("data-tier")).toBe("1");
    }
  }, 30000);

  it("shows only Tier 1 at fit: no Tier 2 tags, no pipe dimensions", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const shown = engineTags(container).map((t) => t.textContent);
    expect(TIER_2.filter((tag) => shown.includes(tag))).toEqual([]);
    expect(textsByKind(container, "pipe-label")).toEqual([]);
    expect(textsByKind(container, "annotation")).toEqual([]);
  }, 30000);

  it("suppresses the routines' own in-glyph tags while the engine is active", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    // No symbol-tag (in-glyph equipment/piping tags), no symbol-caption,
    // no room-label/room-area from the routines — the engine overlay is
    // the only industrial text on the pane.
    expect(textsByKind(container, "symbol-tag")).toEqual([]);
    expect(textsByKind(container, "symbol-caption")).toEqual([]);
    expect(textsByKind(container, "room-label")).toEqual([]);
    expect(textsByKind(container, "room-area")).toEqual([]);
  }, 30000);

  it("renders the Labels control and a Hidden labels disclosure", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    expect(controls).not.toBeNull();
    expect(controls.textContent).toContain("Labels:");
    expect(controls.textContent).toContain("All");
    expect(controls.textContent).toContain("Key only");
    const summary = controls.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary.textContent).toMatch(/Hidden labels \(\d+\)/);
    // The disclosure separates the two reasons, so a Tier 2 tag hidden
    // by zoom is never confused with a Tier 1 tag hidden by collision.
    expect(controls.textContent).toContain("hidden by collision");
    expect(controls.textContent).toContain("hidden by zoom tier");
  }, 30000);

  it("reveals Tier 2 on a 1.5x zoom and hides it again under Key only", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    // Zoom to the 1.5-2.5x band with real wheel events (the zoomRequest
    // path floors at MIN_SCALE 0.35, far above the band): four wheel
    // steps of 1.12x land at z ≈ 1.57 — Tier 2 in, Tier 3 out.
    const svg = container.querySelector("svg");
    for (let i = 0; i < 4; i += 1) {
      act(() => {
        svg.dispatchEvent(
          new window.WheelEvent("wheel", { deltaY: -240, clientX: 200, clientY: 400, bubbles: true, cancelable: true }),
        );
      });
    }
    const shown = engineTags(container).map((t) => t.textContent);
    const tier2Shown = TIER_2.filter((tag) => shown.includes(tag));
    expect(tier2Shown.length).toBeGreaterThanOrEqual(1);
    expect(textsByKind(container, "pipe-label")).toEqual([]);
    // Key only drops back to Tier 1: the Tier 2 tags leave.
    const keyButton = [...container.querySelectorAll('[data-testid="label-engine-controls"] button')].find(
      (b) => b.textContent.trim() === "Key only",
    );
    act(() => {
      keyButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    const shownAfter = engineTags(container).map((t) => t.textContent);
    expect(TIER_2.filter((tag) => shownAfter.includes(tag))).toEqual([]);
    expect(TIER_1.filter((tag) => shownAfter.includes(tag)).length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("Find on a hidden label selects its source and writes nothing", () => {
    mockSize = { w: 400, h: 800 };
    const before = JSON.stringify(fccuDesign);
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    expect(details).not.toBeNull();
    const rows = [...details.querySelectorAll("li")];
    expect(rows.length).toBeGreaterThan(0);
    // Every selectable row carries a Find button; clicking one must
    // select exactly its source object and nothing else — the only
    // dispatch the recovery path ever emits is SELECT. (Annotation
    // rows are excluded: they have no selection kind and open the
    // read-only identity disclosure instead — see the Finding A test.)
    const row = firstSelectableRow(details);
    expect(row).toBeDefined();
    const firstFind = row.querySelector("button");
    expect(firstFind.textContent.trim()).toBe("Find");
    dispatch.mockClear();
    act(() => {
      firstFind.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalled();
    for (const call of dispatch.mock.calls) {
      expect(call[0].type).toBe("SELECT");
      expect(["symbol", "pipe", "room"]).toContain(call[0].selection.kind);
      expect(typeof call[0].selection.id).toBe("string");
    }
    // The design document itself is untouched by the whole flow.
    expect(JSON.stringify(fccuDesign)).toBe(before);
  }, 30000);

  it("search filters the hidden list", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const input = controls.querySelector('input[aria-label="Search hidden labels"]');
    expect(input).not.toBeNull();
    // React ignores a plain value assignment on a controlled input —
    // use the native setter so the onChange fires.
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "P-103");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const rows = [...controls.querySelectorAll("details li")];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.textContent).toContain("P-103");
    }
  }, 30000);

  it("stays inactive on a non-industrial design (overview keeps working)", () => {
    mockSize = { w: 400, h: 800 };
    const homeDesign = { ...fccuDesign, mode: "home" };
    renderCanvas({ design: homeDesign });
    expect(container.querySelector('[data-testid="label-engine-controls"]')).toBeNull();
    // The phone overview still owns equipment tags on a home-mode
    // design — the engine never takes over there.
    expect(container.querySelector("[data-phone-overview-tags]")).not.toBeNull();
  }, 30000);

  // ---- Fix round 1 (PR #862 NEEDS CHANGES) ----

  it("Finding A: Find on a hidden annotation shows its full text immediately and selects nothing", () => {
    mockSize = { w: 400, h: 800 };
    const before = JSON.stringify(fccuDesign);
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    // The long plot-plan annotation is Tier 3, hidden by zoom tier at
    // fit — it has no selection kind, so Find must disclose it.
    const row = [...details.querySelectorAll("li")].find((li) =>
      li.textContent.includes("FICTIONAL FCCU"),
    );
    expect(row).toBeDefined();
    dispatch.mockClear();
    act(() => {
      row.querySelector("button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    // The exact full source text is presented IMMEDIATELY on Find,
    // whether or not the layout can place the label — and no SELECT
    // is dispatched for a source with no selection kind.
    const detail = container.querySelector('[data-testid="label-found-detail"]');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain("FICTIONAL FCCU — GENERIC LAYOUT EXERCISE");
    expect(dispatch).not.toHaveBeenCalled();
    // The disclosure closed so it never obstructs the centred object,
    // and the design document is untouched.
    expect(details.open).toBe(false);
    expect(JSON.stringify(fccuDesign)).toBe(before);
  }, 30000);

  it("Finding A: Find on a label whose source is gone says so and selects nothing", () => {
    mockSize = { w: 400, h: 800 };
    // Deep-copy so the fixture itself is never mutated.
    const designCopy = JSON.parse(JSON.stringify(fccuDesign));
    renderCanvas({ design: designCopy });
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    const row = [...details.querySelectorAll("li")].find((li) =>
      li.textContent.includes("FICTIONAL FCCU"),
    );
    expect(row).toBeDefined();
    // The annotation is deleted between render and click (the race the
    // scope calls out). The app reducer never mutates in place, so the
    // test simulates the race by splicing the array the rendered
    // component captured — the row is still on screen, its source gone.
    designCopy.annotations.splice(
      designCopy.annotations.findIndex((a) => a.id === "fccu_label_5"),
      1,
    );
    dispatch.mockClear();
    act(() => {
      row.querySelector("button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    const detail = container.querySelector('[data-testid="label-found-detail"]');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain("no longer in the design");
    expect(detail.textContent).toContain("FICTIONAL FCCU");
    // A missing source never resolves to a different object.
    expect(dispatch).not.toHaveBeenCalled();
  }, 30000);

  it("Finding B: Find rows and label toggles are ≥44px tap targets", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    // jsdom has no layout engine, so this asserts the 44px minimum
    // class; the Playwright geometry guard measures real bounding
    // rectangles at 360/390/400px.
    const toggles = [...controls.querySelectorAll("button")].filter((b) =>
      ["All", "Key only"].includes(b.textContent.trim()),
    );
    expect(toggles).toHaveLength(2);
    for (const b of toggles) expect(b.className).toContain("min-h-[44px]");
    const details = controls.querySelector("details");
    expect(details.querySelector("summary").className).toContain("min-h-[44px]");
    expect(
      controls.querySelector('input[aria-label="Search hidden labels"]').className,
    ).toContain("min-h-[44px]");
    const findButtons = [...details.querySelectorAll("li button")].filter(
      (b) => b.textContent.trim() === "Find",
    );
    expect(findButtons.length).toBeGreaterThan(0);
    for (const b of findButtons) {
      expect(b.className).toContain("min-h-[44px]");
      expect(b.closest("li").className).toContain("min-h-[44px]");
    }
  }, 30000);

  it("Finding B: Escape closes the disclosure and returns focus to the summary", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    const summary = details.querySelector("summary");
    openHiddenLabels(details);
    const input = controls.querySelector('input[aria-label="Search hidden labels"]');
    act(() => {
      input.focus();
    });
    act(() => {
      input.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  }, 30000);

  it("Finding B: Close button closes the disclosure and returns focus to the summary", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    const summary = details.querySelector("summary");
    openHiddenLabels(details);
    const close = controls.querySelector('button[aria-label="Close hidden labels"]');
    expect(close).not.toBeNull();
    act(() => {
      close.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  }, 30000);

  it("Finding B: Find closes the disclosure so it never obstructs the centred object", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas();
    const controls = container.querySelector('[data-testid="label-engine-controls"]');
    const details = controls.querySelector("details");
    const summary = details.querySelector("summary");
    openHiddenLabels(details);
    const row = firstSelectableRow(details);
    expect(row).toBeDefined();
    act(() => {
      row.querySelector("button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  }, 30000);

  // A small industrial document for Finding C: one wall whose dimension
  // label sits on an equipment glyph (placed via dimensionGeometry, the
  // same helper renderWall uses) and one deck beside it. Small bounds
  // keep the fit scale above the 0.25 detail-label gate, so the legacy
  // labels WOULD render without the engine gate.
  const mixedDesign = () => {
    const wall = { id: "wall-1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } };
    const labelPos = dimensionGeometry(wall, 4.5 / 2 + 10).labelPos;
    return {
      ...fccuDesign,
      symbols: [
        {
          id: "sym-1",
          domain: "processEquipment",
          symbolId: "fluidized-bed-reactor",
          layer: "equipment",
          tag: "E-101",
          x: labelPos.x,
          y: labelPos.y,
          widthIn: 24,
          depthIn: 24,
        },
      ],
      pipes: [],
      rooms: [],
      annotations: [],
      openings: [],
      walls: [wall],
      decks: [{ id: "deck-1", a: { x: 40, y: -40 }, b: { x: 100, y: 20 }, material: "wood", dropIn: 6 }],
    };
  };

  it("Finding C: legacy wall/deck labels stay off while the engine is active", () => {
    mockSize = { w: 400, h: 800 };
    renderCanvas({ design: mixedDesign() });
    // The engine is active and owns the equipment tag.
    expect(container.querySelector('[data-testid="label-engine-controls"]')).not.toBeNull();
    expect(engineTags(container).map((t) => t.textContent)).toContain("E-101");
    // No second, independently collision-free set: the wall dimension
    // and the deck label are gated off while the engine is active.
    expect(textsByKind(container, "wall-label")).toEqual([]);
    expect(textsByKind(container, "deck-label")).toEqual([]);
    // The objects themselves still render — their identities stay
    // recoverable by tapping the wall/deck (selection panel shows
    // length/material, the pre-existing recovery path).
    const svg = container.querySelector("svg");
    expect(svg.querySelector('rect[fill="rgba(160,116,74,0.12)"]')).not.toBeNull();
    expect(svg.querySelectorAll("line").length).toBeGreaterThan(0);
  }, 30000);

  it("Finding C: wall/deck labels still render on a wide pane (engine inactive)", () => {
    mockSize = { w: 1919, h: 800 };
    renderCanvas({ design: mixedDesign() });
    expect(container.querySelector('[data-testid="label-engine-controls"]')).toBeNull();
    expect(textsByKind(container, "wall-label").length).toBeGreaterThan(0);
    expect(textsByKind(container, "deck-label").length).toBeGreaterThan(0);
  }, 30000);
});
