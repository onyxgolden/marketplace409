// Phone label deconfliction (Phone Slice 5): pure-helper unit tests.
// The selector decides which optional dimension/deck labels may render on
// a phone-width pane — only labels whose whole screen rect sits inside
// the pane and collides with nothing already accepted. Deterministic:
// the same input always yields the same accepted set.
import { describe, expect, it } from "vitest";
import {
  estimateTextWidthPx,
  phoneLabelScreenRect,
  phoneLabelScreenRectForAnchor,
  selectPhoneLabels,
} from "./designerGeometry";

describe("estimateTextWidthPx", () => {
  it("is deterministic and grows with text and font size", () => {
    expect(estimateTextWidthPx('360"', 12)).toBe(estimateTextWidthPx('360"', 12));
    expect(estimateTextWidthPx('720"', 12)).toBeGreaterThan(estimateTextWidthPx('24"', 12));
    expect(estimateTextWidthPx('360"', 13)).toBeGreaterThan(estimateTextWidthPx('360"', 12));
  });

  it("is conservative against the measured Chromium width (24px for 360\" at 12px)", () => {
    // Real getBBox width for `360"` at 12px is 24px; the estimate must not
    // under-measure, or the selector would admit a label that collides.
    expect(estimateTextWidthPx('360"', 12)).toBeGreaterThanOrEqual(24);
  });

  it("returns 0 for empty or invalid input", () => {
    expect(estimateTextWidthPx("", 12)).toBe(0);
    expect(estimateTextWidthPx(null, 12)).toBe(0);
    expect(estimateTextWidthPx('360"', 0)).toBe(0);
  });
});

describe("phoneLabelScreenRect", () => {
  it("is the identity rect at 0 degrees", () => {
    expect(
      phoneLabelScreenRect({ centerX: 100, centerY: 50, widthPx: 30, heightPx: 12, angleDeg: 0 }),
    ).toEqual({ left: 85, top: 44, right: 115, bottom: 56 });
  });

  it("swaps width and height at 90 degrees (vertical wall label)", () => {
    expect(
      phoneLabelScreenRect({ centerX: 100, centerY: 50, widthPx: 30, heightPx: 12, angleDeg: 90 }),
    ).toEqual({ left: 94, top: 35, right: 106, bottom: 65 });
  });

  it("widens the box at 45 degrees", () => {
    const r = phoneLabelScreenRect({ centerX: 100, centerY: 50, widthPx: 30, heightPx: 12, angleDeg: 45 });
    expect(r.right - r.left).toBeCloseTo((30 + 12) * Math.SQRT1_2, 6);
    expect(r.bottom - r.top).toBeCloseTo((30 + 12) * Math.SQRT1_2, 6);
  });

  it("defaults a missing angle to 0", () => {
    expect(
      phoneLabelScreenRect({ centerX: 0, centerY: 0, widthPx: 10, heightPx: 4 }),
    ).toEqual({ left: -5, top: -2, right: 5, bottom: 2 });
  });
});

describe("phoneLabelScreenRectForAnchor", () => {
  it("matches the center-based rect at 0 degrees", () => {
    expect(
      phoneLabelScreenRectForAnchor({ anchorX: 100, anchorY: 50, widthPx: 30, heightPx: 14, angleDeg: 0, baselineOffsetPx: 4.2 }),
    ).toEqual(
      phoneLabelScreenRect({ centerX: 100, centerY: 45.8, widthPx: 30, heightPx: 14, angleDeg: 0 }),
    );
  });

  it("shifts a 90-degree label's AABB center sideways by the baseline offset (measured +4.1px)", () => {
    // A vertical wall's "360\"" label: anchor x 698.9, real rect 696-710
    // (center 703). The box center is NOT the anchor — rotating about
    // the anchor moves it ~baselineOffsetPx to the side.
    const r = phoneLabelScreenRectForAnchor({ anchorX: 698.9, anchorY: 200, widthPx: 29.8, heightPx: 14.4, angleDeg: 90, baselineOffsetPx: 4.2 });
    expect((r.left + r.right) / 2).toBeCloseTo(703.1, 0);
    expect(r.right - r.left).toBeCloseTo(14.4, 6);
    expect(r.bottom - r.top).toBeCloseTo(29.8, 6);
  });

  it("shifts a -90-degree label's AABB center the other way (measured -4.2px)", () => {
    const r = phoneLabelScreenRectForAnchor({ anchorX: 9.1, anchorY: 200, widthPx: 29.8, heightPx: 14.4, angleDeg: -90, baselineOffsetPx: 4.2 });
    expect((r.left + r.right) / 2).toBeCloseTo(4.9, 0);
  });
});

const viewport = { left: 0, top: 0, right: 390, bottom: 700 };
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

describe("selectPhoneLabels", () => {
  it("accepts non-colliding labels inside the viewport", () => {
    const accepted = selectPhoneLabels(
      [
        { id: "a", rect: rect(10, 10, 60, 24), priority: 100 },
        { id: "b", rect: rect(100, 10, 150, 24), priority: 50 },
      ],
      viewport,
    );
    expect([...accepted].sort()).toEqual(["a", "b"]);
  });

  it("rejects a label colliding with an accepted one (4px pad)", () => {
    // 8px apart with 4px pad on each side: the second label's rect starts
    // inside the first's padded box, so it is withheld.
    const accepted = selectPhoneLabels(
      [
        { id: "a", rect: rect(100, 100, 130, 114), priority: 100 },
        { id: "b", rect: rect(104, 100, 134, 114), priority: 90 },
      ],
      viewport,
    );
    expect([...accepted]).toEqual(["a"]);
  });

  it("rejects a label whose rect leaves the viewport (2px inset)", () => {
    const accepted = selectPhoneLabels(
      [
        { id: "inside", rect: rect(10, 10, 60, 24), priority: 1 },
        { id: "right-edge", rect: rect(350, 10, 391, 24), priority: 100 },
        { id: "left-edge", rect: rect(-1, 10, 40, 24), priority: 100 },
      ],
      viewport,
    );
    expect([...accepted]).toEqual(["inside"]);
  });

  it("selected beats longer: the selected label wins and displaces its collider", () => {
    const accepted = selectPhoneLabels(
      [
        { id: "long", rect: rect(100, 100, 200, 114), priority: 720 },
        { id: "short-selected", rect: rect(104, 100, 134, 114), priority: 24, selected: true },
      ],
      viewport,
    );
    expect([...accepted]).toEqual(["short-selected"]);
  });

  it("is deterministic: equal priorities break ties by id, same input same output", () => {
    const candidates = [
      { id: "wall-b", rect: rect(100, 100, 130, 114), priority: 192 },
      { id: "wall-a", rect: rect(104, 100, 134, 114), priority: 192 },
      { id: "wall-c", rect: rect(200, 100, 230, 114), priority: 192 },
    ];
    const first = selectPhoneLabels(candidates, viewport);
    const second = selectPhoneLabels([...candidates].reverse(), viewport);
    expect([...first]).toEqual(["wall-a", "wall-c"]);
    expect([...second]).toEqual([...first]);
  });

  it("returns an empty set for empty or invalid input", () => {
    expect(selectPhoneLabels([], viewport).size).toBe(0);
    expect(selectPhoneLabels(null, viewport).size).toBe(0);
    expect(selectPhoneLabels([{ id: "a", rect: rect(10, 10, 20, 20) }], null).size).toBe(0);
  });
});

// Phone Slice 5 follow-up: whole-plot overview equipment tags. One
// candidate per tagged equipment symbol; piping symbols are never
// candidates. The caller runs the candidates through selectPhoneLabels
// (selected first, then equipment priority, then tag order).
import {
  PHONE_OVERVIEW_TAG_MAX,
  phoneOverviewTagCandidates,
} from "./designerGeometry";

describe("phoneOverviewTagCandidates", () => {
  const toScreen = (p) => ({ x: p.x, y: p.y });
  const viewport = { left: 0, top: 0, right: 300, bottom: 800 };
  const eq = (over) => ({
    id: over.id ?? `sym_${over.tag}`,
    tag: over.tag,
    symbolId: over.symbolId ?? "centrifugal-pump",
    layer: "equipment",
    x: over.x ?? 100,
    y: over.y ?? 100,
    depthIn: over.depthIn ?? 60,
  });

  it("builds one candidate per tagged equipment symbol, with a stable id", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [eq({ tag: "R-101", symbolId: "fluidized-bed-reactor", x: 100, y: 100 })],
      toScreen,
      scale: 0.033,
      selectedId: null,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("equipment-tag:R-101");
    expect(candidates[0].tag).toBe("R-101");
    expect(candidates[0].priority).toBe(100);
    expect(candidates[0].selected).toBe(false);
    expect(candidates[0].screenX).toBe(100);
  });

  it("ranks primary equipment above pumps above racks, ties by tag", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [
        eq({ tag: "PR-101", symbolId: "pipe-rack", x: 100, y: 500 }),
        eq({ tag: "P-101", symbolId: "centrifugal-pump", x: 100, y: 300 }),
        eq({ tag: "E-101", symbolId: "shell-tube-exchanger", x: 100, y: 200 }),
        eq({ tag: "R-101", symbolId: "fluidized-bed-reactor", x: 100, y: 100 }),
      ],
      toScreen,
      scale: 0.033,
      selectedId: null,
    });
    const accepted = selectPhoneLabels(candidates, viewport);
    // All four are far apart vertically, so all are accepted; the
    // selector's deterministic order is priority order.
    expect([...accepted]).toEqual([
      "equipment-tag:R-101",
      "equipment-tag:E-101",
      "equipment-tag:P-101",
      "equipment-tag:PR-101",
    ]);
  });

  it("withholds a colliding lower-priority tag and keeps the higher one", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [
        eq({ tag: "R-101", symbolId: "fluidized-bed-reactor", x: 100, y: 100 }),
        eq({ tag: "R-102", symbolId: "catalyst-regenerator", x: 110, y: 100 }),
      ],
      toScreen,
      scale: 0.033,
      selectedId: null,
    });
    const accepted = selectPhoneLabels(candidates, viewport);
    expect([...accepted]).toEqual(["equipment-tag:R-101"]);
  });

  it("selected wins over a colliding higher-priority tag", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [
        eq({ tag: "R-101", symbolId: "fluidized-bed-reactor", x: 100, y: 100 }),
        eq({ tag: "R-102", symbolId: "catalyst-regenerator", x: 110, y: 100 }),
      ],
      toScreen,
      scale: 0.033,
      selectedId: "sym_R-102",
    });
    const accepted = selectPhoneLabels(candidates, viewport);
    expect([...accepted]).toEqual(["equipment-tag:R-102"]);
  });

  it("withholds a tag whose rect leaves the pane", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [eq({ tag: "FL-101", symbolId: "flare-stack", x: 295, y: 100 })],
      toScreen,
      scale: 0.033,
      selectedId: null,
    });
    expect(selectPhoneLabels(candidates, viewport).size).toBe(0);
  });

  it("skips untagged equipment and returns [] for empty input", () => {
    const candidates = phoneOverviewTagCandidates({
      equipment: [{ id: "s1", layer: "equipment", x: 100, y: 100 }],
      toScreen,
      scale: 0.033,
      selectedId: null,
    });
    expect(candidates).toEqual([]);
    expect(phoneOverviewTagCandidates({ equipment: [], toScreen, scale: 0.033, selectedId: null })).toEqual([]);
  });

  it("does not cap the candidate list itself (PlanCanvas applies PHONE_OVERVIEW_TAG_MAX after selection)", () => {
    const equipment = Array.from({ length: 20 }, (_, i) => eq({ tag: `P-${100 + i}`, x: 100, y: 40 + i * 40 }));
    const candidates = phoneOverviewTagCandidates({ equipment, toScreen, scale: 0.033, selectedId: null });
    expect(candidates).toHaveLength(20);
    expect(PHONE_OVERVIEW_TAG_MAX).toBe(12);
  });
});
