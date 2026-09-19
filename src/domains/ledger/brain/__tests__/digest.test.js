import { describe, expect, it } from "vitest";

import { buildBrainDigest, renderDigestText } from "../digest.js";

const NOW = "2026-09-19";

function shortfall(overrides = {}) {
  return {
    accountId: "a1",
    accountName: "Business Savings",
    type: "shortfall",
    date: "2026-10-12",
    projectedBalance: -240,
    daysFromStart: 23,
    ...overrides,
  };
}

function tight(overrides = {}) {
  return {
    accountId: "a2",
    accountName: "Checking",
    type: "tight",
    date: "2026-10-01",
    projectedBalance: 500,
    daysFromStart: 12,
    ...overrides,
  };
}

describe("buildBrainDigest", () => {
  it("returns an empty digest on empty inputs without throwing", () => {
    const digest = buildBrainDigest({ now: NOW });
    expect(digest.generatedAt).toBe("2026-09-19");
    expect(digest.items).toEqual([]);
    expect(() => JSON.parse(JSON.stringify(digest))).not.toThrow();
  });

  it("ranks shortfalls above anomalies, overruns, backlog, and tight warnings", () => {
    const digest = buildBrainDigest({
      now: NOW,
      anomalies: [
        { type: "duplicate", severity: "high", title: "Possible duplicate charge: Dugood", detail: "$1,482.50 charged twice, 3 days apart." },
      ],
      forecast: { warnings: [tight(), shortfall()] },
      pendingSuggestions: 4,
      budgetOverruns: [{ label: "Dining", overAmountCents: 5230, month: "2026-09" }],
    });
    const kinds = digest.items.map((item) => item.kind);
    expect(kinds).toEqual([
      "cash-shortfall",
      "anomaly-duplicate",
      "budget-overrun",
      "uncategorized",
      "cash-tight",
    ]);
  });

  it("keeps anomaly severity order from the detector", () => {
    const digest = buildBrainDigest({
      now: NOW,
      anomalies: [
        { type: "spend-spike", severity: "high", title: "Dining spend is up 2.4x vs usual" },
        { type: "new-payee", severity: "low", title: "New payee: Big Vendor" },
        { type: "recurring-drift", severity: "medium", title: "Mortgage changed 12% up" },
      ],
    });
    expect(digest.items.map((i) => i.severity)).toEqual(["high", "low", "medium"]);
  });

  it("caps the digest at five items", () => {
    const digest = buildBrainDigest({
      now: NOW,
      anomalies: Array.from({ length: 10 }, (_, i) => ({
        type: "spend-spike",
        severity: "low",
        title: `Spike ${i}`,
      })),
      forecast: { warnings: [shortfall(), tight()] },
      pendingSuggestions: 9,
      budgetOverruns: [{ label: "Dining", overAmountCents: 100, month: "2026-09" }],
    });
    expect(digest.items).toHaveLength(5);
    expect(digest.items[0].kind).toBe("cash-shortfall");
  });

  it("omits the backlog item when nothing is pending and drops zero overruns", () => {
    const digest = buildBrainDigest({
      now: NOW,
      pendingSuggestions: 0,
      budgetOverruns: [{ label: "Dining", overAmountCents: 0 }],
    });
    expect(digest.items).toEqual([]);
  });

  it("serializes to JSON cleanly", () => {
    const digest = buildBrainDigest({
      now: NOW,
      anomalies: [{ type: "duplicate", severity: "high", title: "Dup", detail: "x" }],
      forecast: { warnings: [shortfall()] },
      pendingSuggestions: 2,
      budgetOverruns: [{ label: "Dining", overAmountCents: 5230, month: "2026-09" }],
    });
    const roundTripped = JSON.parse(JSON.stringify(digest));
    expect(roundTripped.items).toHaveLength(4);
    expect(Object.isFrozen(digest.items)).toBe(true);
  });
});

describe("renderDigestText", () => {
  it("renders ranked lines with severity tags and pointers", () => {
    const digest = buildBrainDigest({
      now: NOW,
      forecast: { warnings: [shortfall()] },
      budgetOverruns: [{ label: "Dining", overAmountCents: 5230, month: "2026-09" }],
    });
    const text = renderDigestText(digest);
    const lines = text.split("\n");
    expect(lines[0]).toBe("FORGE Brain digest");
    expect(lines[1]).toContain("[HIGH]");
    expect(lines[1]).toContain("Business Savings projected negative on Oct 12");
    expect(lines[1]).toContain("(/forge/financial)");
    expect(lines[2]).toContain("[MED]");
    expect(lines[2]).toContain("$52.30 over plan for 2026-09");
    expect(lines[2]).toContain("(/forge/budget)");
  });

  it("says all quiet when there is nothing to flag", () => {
    const text = renderDigestText(buildBrainDigest({ now: NOW }));
    expect(text).toBe(
      "FORGE Brain digest: all quiet — no shortfalls, anomalies, or overruns.",
    );
  });

  it("handles a null digest without throwing", () => {
    expect(() => renderDigestText(null)).not.toThrow();
  });
});
