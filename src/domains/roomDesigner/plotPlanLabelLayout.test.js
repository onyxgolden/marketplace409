// Pure-logic tests for the deterministic plot-plan label layout engine.
// No DOM, no React: every measurement goes through an injected stub
// (7px per character) so the geometry is exact and repeatable.

import { describe, expect, it } from "vitest";
import {
  LABEL_ANCHOR_OFFSET_PX,
  LABEL_COLLISION_PAD_PX,
  LABEL_LEADER_MAX,
  layoutPlotPlanLabels,
  maxTierForRelativeZoom,
  tierForRelativeZoom,
} from "./plotPlanLabelLayout";
import {
  FCCU_TIER_1_TAGS,
  FCCU_TIER_2_TAGS,
  fccuTierForTag,
  genericTierForEquipmentTag,
  tierForEquipmentTag,
} from "./fccuLabelTierOverrides";

const measureStub = (text) => text.length * 7;
const VIEWPORT = { left: 0, top: 0, right: 400, bottom: 800 };

function cand(overrides = {}) {
  return {
    id: "equipment-tag:R-101",
    kind: "equipment-tag",
    tier: 1,
    rank: 0,
    tag: "R-101",
    fullLabel: "R-101 Fluidized-bed reactor",
    text: "R-101",
    fontSizePx: 13,
    fontWeight: 700,
    anchor: { x: 200, y: 400, halfW: 4, halfH: 4 },
    segment: null,
    sourceId: "symbol_1",
    sourceKind: "symbol",
    source: { plan: { x: 2280, y: 2040 } },
    ...overrides,
  };
}

function layout(candidates, options = {}) {
  return layoutPlotPlanLabels({
    candidates,
    viewport: VIEWPORT,
    maxTier: 3,
    measureTextWidth: measureStub,
    ...options,
  });
}

describe("tierForRelativeZoom", () => {
  it("reveals Tier 2 at 1.5x and Tier 3 at 2.5x on the way up", () => {
    expect(tierForRelativeZoom(1.0, 1)).toBe(1);
    expect(tierForRelativeZoom(1.49, 1)).toBe(1);
    expect(tierForRelativeZoom(1.5, 1)).toBe(2);
    expect(tierForRelativeZoom(2.49, 2)).toBe(2);
    expect(tierForRelativeZoom(2.5, 2)).toBe(3);
    expect(tierForRelativeZoom(3.0, 1)).toBe(3);
  });
  it("hides a tier only below threshold minus 5% on the way down", () => {
    expect(tierForRelativeZoom(2.4, 3)).toBe(3); // inside the band
    expect(tierForRelativeZoom(2.37, 3)).toBe(2); // below 2.5 * 0.95
    expect(tierForRelativeZoom(1.45, 2)).toBe(2); // inside the band
    expect(tierForRelativeZoom(1.42, 2)).toBe(1); // below 1.5 * 0.95
    expect(tierForRelativeZoom(1.3, 3)).toBe(1); // cascades through both bands
  });
  it("initialises directly from z with no previous tier", () => {
    expect(tierForRelativeZoom(1.0, null)).toBe(1);
    expect(tierForRelativeZoom(1.6, undefined)).toBe(2);
    expect(tierForRelativeZoom(2.6, null)).toBe(3);
    expect(maxTierForRelativeZoom(1.49)).toBe(1);
    expect(maxTierForRelativeZoom(2.5)).toBe(3);
    expect(tierForRelativeZoom(Number.NaN, 2)).toBe(1);
  });
});

describe("layoutPlotPlanLabels", () => {
  it("places a lone label upper-left of its glyph, inside the pane", () => {
    const { placed, withheld, diagnostics } = layout([cand()]);
    expect(withheld).toHaveLength(0);
    expect(placed).toHaveLength(1);
    const p = placed[0];
    // Upper-left is tried first (see the order note in
    // plotPlanLabelLayout.js): a lone label nests to the left.
    expect(p.position).toBe("upper-left");
    expect(p.leader).toBeNull();
    // Box sits 6px left of the glyph's left edge and 6px above its top.
    expect(p.rect.right).toBe(200 - 4 - LABEL_ANCHOR_OFFSET_PX);
    expect(p.rect.bottom).toBe(400 - 4 - LABEL_ANCHOR_OFFSET_PX);
    expect(p.rect.left).toBeGreaterThanOrEqual(VIEWPORT.left + 2);
    expect(diagnostics.byTier[1].placed).toBe(1);
  });

  it("tries upper-left before upper-right (accepted try-order, PR #862 fix round 1)", () => {
    // A glyph hard against the pane's left edge: upper-left would fall
    // outside the viewport, so the label must fall back to upper-right
    // — proving upper-left was tried first and rejected, not skipped.
    // The reviewer ACCEPTED upper-left-first 2026-11-26 (upper-right
    // first withholds 5/14 Tier 1 at fit; upper-left-first places
    // 10/14): do not revert this order.
    const edge = cand({ anchor: { x: 10, y: 400, halfW: 4, halfH: 4 } });
    const { placed, withheld } = layout([edge]);
    expect(withheld).toHaveLength(0);
    expect(placed).toHaveLength(1);
    expect(placed[0].position).toBe("upper-right");
    // And a lone label with room on both sides still takes upper-left.
    const again = layout([cand()]);
    expect(again.placed).toHaveLength(1);
    expect(again.placed[0].position).toBe("upper-left");
  });

  it("tries the other three corners before withholding a colliding label", () => {
    // Two tags on the same glyph: the second cannot take upper-left
    // (taken), so it must fall back to another corner, not vanish.
    const a = cand({ id: "equipment-tag:R-101", tag: "R-101", rank: 0 });
    const b = cand({ id: "equipment-tag:R-102", tag: "R-102", rank: 1 });
    const { placed, withheld } = layout([a, b]);
    expect(withheld).toHaveLength(0);
    expect(placed).toHaveLength(2);
    expect(placed[0].position).toBe("upper-left");
    expect(placed[1].position).toBe("upper-right");
    const [r1, r2] = placed.map((p) => p.rect);
    expect(r1.left < r2.right && r2.left < r1.right && r1.top < r2.bottom && r2.top < r1.bottom).toBe(false);
  });

  it("withholds a label when all four corners collide, and reports it", () => {
    // Five tags stacked on one glyph: at most four corners exist, so
    // the fifth (lowest priority) is withheld by collision.
    const cs = [0, 1, 2, 3, 4].map((i) =>
      cand({ id: `equipment-tag:T-${i}`, tag: `T-${i}`, rank: i }),
    );
    const { placed, withheld, diagnostics } = layout(cs);
    expect(placed).toHaveLength(4);
    expect(withheld).toHaveLength(1);
    expect(withheld[0].reason).toBe("collision");
    expect(withheld[0].rank).toBe(4);
    expect(diagnostics.byTier[1].hidden).toBe(1);
    expect(diagnostics.counts.placed).toBe(4);
  });

  it("is deterministic: same input twice, and shuffled input, give the same placed set", () => {
    const cs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      cand({
        id: `equipment-tag:T-${i}`,
        tag: `T-${i}`,
        rank: i,
        anchor: { x: 100 + (i % 4) * 60, y: 200 + Math.floor(i / 4) * 90, halfW: 3, halfH: 3 },
      }),
    );
    const first = layout(cs);
    const second = layout(cs);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const shuffled = layout([...cs].reverse());
    const key = (p) => `${p.id}@${p.rect.left},${p.rect.top},${p.position}`;
    expect(shuffled.placed.map(key).sort()).toEqual(first.placed.map(key).sort());
    expect(shuffled.withheld.map((w) => w.id).sort()).toEqual(first.withheld.map((w) => w.id).sort());
  });

  it("respects maxTier: Tier 2/3 are hidden by tier, not by collision", () => {
    const cs = [
      cand({ id: "equipment-tag:R-101", tier: 1, rank: 0 }),
      cand({ id: "equipment-tag:P-102", tag: "P-102", tier: 2, rank: 0, anchor: { x: 260, y: 400, halfW: 3, halfH: 3 } }),
      cand({ id: "pipe-label:p1", kind: "pipe-label", tier: 3, rank: 0, text: "120″ ⌀8″", anchor: { x: 300, y: 500, halfW: 0, halfH: 0 } }),
    ];
    const { placed, withheld, tierHidden } = layout(cs, { maxTier: 1 });
    expect(placed).toHaveLength(1);
    expect(withheld).toHaveLength(0);
    expect(tierHidden).toHaveLength(2);
    expect(tierHidden.map((t) => t.reason)).toEqual(["tier", "tier"]);
  });

  it("keeps every placed box inside the viewport (containment)", () => {
    const cs = [
      cand({ anchor: { x: 4, y: 4, halfW: 2, halfH: 2 } }),
      cand({ id: "equipment-tag:EDGE", tag: "EDGE", anchor: { x: 398, y: 798, halfW: 2, halfH: 2 } }),
    ];
    const { placed } = layout(cs);
    for (const p of placed) {
      expect(p.rect.left).toBeGreaterThanOrEqual(2);
      expect(p.rect.top).toBeGreaterThanOrEqual(2);
      expect(p.rect.right).toBeLessThanOrEqual(398);
      expect(p.rect.bottom).toBeLessThanOrEqual(798);
    }
  });

  it("caps leaders at four and draws them only for lower placements", () => {
    // Three anchors, five tags stacked on each. Each anchor's first
    // four tags take the four corners (two upper, no leader; two lower,
    // with leaders) and the fifth is withheld. After two anchors the
    // four-leader cap is spent, so the third anchor's lower tags are
    // withheld too — only its two upper tags survive.
    const anchors = [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 200, y: 500 },
    ];
    const cs = [];
    anchors.forEach((anchor, a) => {
      for (let i = 0; i < 5; i += 1) {
        cs.push(
          cand({
            id: `equipment-tag:L-${a}-${i}`,
            tag: `L-${a}-${i}`,
            rank: a * 5 + i,
            anchor: { x: anchor.x, y: anchor.y, halfW: 3, halfH: 3 },
          }),
        );
      }
    });
    const { placed, withheld, diagnostics } = layout(cs);
    expect(diagnostics.leaders).toBe(LABEL_LEADER_MAX);
    expect(placed).toHaveLength(10);
    expect(withheld).toHaveLength(5);
    for (const p of placed) {
      if (p.leader) {
        expect(["lower-right", "lower-left"]).toContain(p.position);
        expect(p.leader.dotX).toBeDefined();
        expect(p.leader.dotY).toBeDefined();
      } else {
        expect(["upper-right", "upper-left"]).toContain(p.position);
      }
    }
    // The third anchor lost its lower tags to the cap, not to collisions
    // with each other: its withheld tags are exactly ranks 2, 3, 4.
    const thirdWithheld = withheld
      .filter((w) => w.id.startsWith("equipment-tag:L-2-"))
      .map((w) => w.id);
    expect(thirdWithheld).toEqual([
      "equipment-tag:L-2-2",
      "equipment-tag:L-2-3",
      "equipment-tag:L-2-4",
    ]);
    expect(diagnostics.leaders).toBe(diagnostics.byTier[1].leadered);
  });

  it("rotates a pipe label only when the segment can hold it", () => {
    // A long label on a vertical pipe, centred where no horizontal box
    // fits: the 220px-wide text cannot sit left or right of x=200
    // inside a 400px pane, but the 90-degree rotated AABB (26px wide,
    // 220px tall) fits. The rotated attempt is the one that wins.
    const longText = "120″ ⌀8″ · 120″ ⌀8″ · 120″ ⌀8″";
    const longPipe = cand({
      id: "pipe-label:long",
      kind: "pipe-label",
      tier: 3,
      text: longText,
      anchor: { x: 200, y: 400, halfW: 0, halfH: 0 },
      segment: { angleDeg: 90, lengthPx: 300 },
    });
    const { placed, withheld } = layout([longPipe]);
    expect(withheld).toHaveLength(0);
    expect(placed).toHaveLength(1);
    expect(placed[0].position).toBe("rotated");
    expect(placed[0].angleDeg).toBe(90);
    expect(placed[0].leader).toBeNull();

    // Same geometry, but the straight segment is too short to hold the
    // text: no rotated attempt, and no horizontal box fits either, so
    // the label is withheld rather than drawn clipped.
    const tooShort = layout([
      cand({
        id: "pipe-label:short",
        kind: "pipe-label",
        tier: 3,
        text: longText,
        anchor: { x: 200, y: 400, halfW: 0, halfH: 0 },
        segment: { angleDeg: 90, lengthPx: 20 },
      }),
    ]);
    expect(tooShort.placed).toHaveLength(0);
    expect(tooShort.withheld).toHaveLength(1);
    expect(tooShort.withheld[0].reason).toBe("collision");

    // A short label on an ordinary pipe takes a horizontal spot and is
    // never rotated: horizontal is the default.
    const shortPipe = cand({
      id: "pipe-label:plain",
      kind: "pipe-label",
      tier: 3,
      text: "120″ ⌀8″",
      anchor: { x: 200, y: 600, halfW: 0, halfH: 0 },
      segment: { angleDeg: 30, lengthPx: 500 },
    });
    const short = layout([shortPipe]);
    expect(short.placed).toHaveLength(1);
    expect(short.placed[0].position).not.toBe("rotated");
  });

  it("handles a 200-candidate dense scene deterministically", () => {
    const cs = [];
    for (let i = 0; i < 200; i += 1) {
      cs.push(
        cand({
          id: `equipment-tag:D-${i}`,
          tag: `D-${i}`,
          tier: (i % 3) + 1,
          rank: i,
          text: `D-${i}`,
          anchor: { x: 20 + (i % 10) * 36, y: 20 + Math.floor(i / 10) * 36, halfW: 2, halfH: 2 },
        }),
      );
    }
    const first = layout(cs);
    const second = layout(cs);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Placed boxes never intersect (padding is baked into the rect).
    for (let i = 0; i < first.placed.length; i += 1) {
      for (let j = i + 1; j < first.placed.length; j += 1) {
        const a = first.placed[i].rect;
        const b = first.placed[j].rect;
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap).toBe(false);
      }
    }
    expect(first.diagnostics.counts.candidates).toBe(200);
    expect(first.diagnostics.counts.placed + first.diagnostics.counts.withheld).toBe(200);
  });

  it("bakes the 5px collision pad into each reserved box", () => {
    // "R-101" is 5 chars at 7px/char through the stub measurer, so the
    // reserved box is exactly 5*7 + 2*5 = 45px wide and
    // ceil(13 * 1.2) + 2*5 = 26px tall — the glyph box plus the pad on
    // every side. Two labels on one glyph get disjoint reserved boxes,
    // so their glyphs can never touch.
    const a = cand({ anchor: { x: 100, y: 400, halfW: 0, halfH: 0 } });
    const b = cand({
      id: "equipment-tag:R-102",
      tag: "R-102",
      rank: 1,
      anchor: { x: 100, y: 400, halfW: 0, halfH: 0 },
    });
    const { placed } = layout([a, b]);
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(p.rect.right - p.rect.left).toBe(5 * 7 + 2 * LABEL_COLLISION_PAD_PX);
      expect(p.rect.bottom - p.rect.top).toBe(Math.ceil(13 * 1.2) + 2 * LABEL_COLLISION_PAD_PX);
    }
    const [r1, r2] = placed.map((p) => p.rect);
    expect(r1.left < r2.right && r2.left < r1.right && r1.top < r2.bottom && r2.top < r1.bottom).toBe(false);
    expect(LABEL_COLLISION_PAD_PX).toBe(5);
  });
});

describe("fccuLabelTierOverrides", () => {
  it("classifies the real 21 FCCU tags as 14 Tier 1 / 7 Tier 2, in rank order", () => {
    expect(FCCU_TIER_1_TAGS).toHaveLength(14);
    expect(FCCU_TIER_2_TAGS).toHaveLength(7);
    expect(FCCU_TIER_1_TAGS[0]).toBe("R-101");
    expect(FCCU_TIER_1_TAGS[13]).toBe("FL-101");
    expect(FCCU_TIER_2_TAGS[0]).toBe("P-102");
    const all = [...FCCU_TIER_1_TAGS, ...FCCU_TIER_2_TAGS];
    expect(new Set(all).size).toBe(21);
    for (const tag of FCCU_TIER_1_TAGS) {
      expect(fccuTierForTag({ sourceProjectId: "design_mwjvt635_lmexii", tag }).tier).toBe(1);
    }
    for (const tag of FCCU_TIER_2_TAGS) {
      expect(fccuTierForTag({ sourceProjectId: "design_mwjvt635_lmexii", tag }).tier).toBe(2);
    }
  });

  it("does not apply FCCU ranks to another design, even for the same tag text", () => {
    expect(fccuTierForTag({ sourceProjectId: "design_other", tag: "E-101" })).toBeNull();
    expect(fccuTierForTag({ sourceProjectId: undefined, tag: "E-101" })).toBeNull();
    expect(tierForEquipmentTag({ sourceProjectId: "design_other", tag: "E-101" })).toEqual({
      tier: 2,
      rank: 0,
      source: "generic",
    });
    expect(tierForEquipmentTag({ sourceProjectId: "design_mwjvt635_lmexii", tag: "E-101" })).toEqual({
      tier: 1,
      rank: 4,
      source: "fccu-manifest",
    });
  });

  it("generic fallback is Tier 2 unless explicitly flagged key", () => {
    expect(genericTierForEquipmentTag({ tag: "X-9" }).tier).toBe(2);
    expect(genericTierForEquipmentTag({ tag: "X-9", flaggedKey: true }).tier).toBe(1);
    expect(genericTierForEquipmentTag({ tag: "" }).tier).toBe(2);
  });
});
