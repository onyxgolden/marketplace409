import { describe, expect, it } from "vitest";

import { buildMorningQueue } from "../morningQueue.js";

const NOW = "2026-09-19";

function row(overrides = {}) {
  return {
    eventId: "e1",
    eventDate: "2026-09-18",
    amount: -42.5,
    description: "Shell Oil",
    side: "outbound",
    reason: "ambiguous",
    suggestion: { category: "fuel", confidence: 0.9, reasons: ["merchant"] },
    ...overrides,
  };
}

function alert(overrides = {}) {
  return {
    type: "spend-spike",
    severity: "high",
    title: "Spending spike: dining",
    detail: "$900 vs $300 baseline",
    key: "spend-spike:abc123",
    evidence: {},
    ...overrides,
  };
}

function bill(overrides = {}) {
  return {
    accountName: "Home Equity",
    category: "mortgage_payment",
    cadence: "biweekly",
    medianAmount: 1482.5,
    nextExpectedDate: "2026-09-22",
    ...overrides,
  };
}

function overrun(overrides = {}) {
  return {
    label: "Other",
    overAmountCents: 1033326,
    month: "2026-09",
    ...overrides,
  };
}

describe("buildMorningQueue", () => {
  it("returns an empty queue on empty inputs without throwing", () => {
    const queue = buildMorningQueue({ now: NOW });
    expect(queue.generatedAt).toBe("2026-09-19T00:00:00.000Z");
    expect(queue.items).toEqual([]);
    expect(queue.counts).toEqual({
      total: 0,
      uncategorized: 0,
      anomaly: 0,
      bill: 0,
      overrun: 0,
    });
    expect(() => JSON.parse(JSON.stringify(queue))).not.toThrow();
    expect(Object.isFrozen(queue)).toBe(true);
  });

  it("ranks kinds in order: uncategorized, anomaly, bill, overrun", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [row({ eventId: "e1" })],
      alerts: [alert({ key: "k1" })],
      bills: [bill()],
      overruns: [overrun()],
      now: NOW,
    });
    expect(queue.items.map((item) => item.kind)).toEqual([
      "uncategorized",
      "anomaly",
      "bill",
      "overrun",
    ]);
    expect(queue.counts).toEqual({
      total: 4,
      uncategorized: 1,
      anomaly: 1,
      bill: 1,
      overrun: 1,
    });
  });

  it("sorts uncategorized rows by largest amount first", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [
        row({ eventId: "small", amount: -5 }),
        row({ eventId: "big", amount: -5000 }),
      ],
      now: NOW,
    });
    expect(queue.items.map((item) => item.id)).toEqual([
      "uncategorized:big",
      "uncategorized:small",
    ]);
  });

  it("sorts anomalies by severity then magnitude", () => {
    const queue = buildMorningQueue({
      alerts: [
        alert({ key: "low", severity: "low", rankMagnitude: 9999 }),
        alert({ key: "high", severity: "high", rankMagnitude: 1 }),
        alert({ key: "med", severity: "medium", rankMagnitude: 5 }),
      ],
      now: NOW,
    });
    expect(queue.items.map((item) => item.id)).toEqual([
      "anomaly:high",
      "anomaly:med",
      "anomaly:low",
    ]);
  });

  it("sorts bills by due date ascending and overruns by amount descending", () => {
    const queue = buildMorningQueue({
      bills: [
        bill({ nextExpectedDate: "2026-10-01", accountName: "Later" }),
        bill({ nextExpectedDate: "2026-09-22", accountName: "Sooner" }),
      ],
      overruns: [
        overrun({ label: "Small", overAmountCents: 100 }),
        overrun({ label: "Big", overAmountCents: 50000 }),
      ],
      now: NOW,
    });
    expect(queue.items[0].kind).toBe("bill");
    expect(queue.items[0].payload.nextExpectedDate).toBe("2026-09-22");
    expect(queue.items[2].payload.label).toBe("Big");
    expect(queue.items[3].payload.label).toBe("Small");
  });

  it("dedupes identical ids within a kind", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [row({ eventId: "e1" }), row({ eventId: "e1" })],
      now: NOW,
    });
    expect(queue.items).toHaveLength(1);
  });

  it("drops an uncategorized row covered by a duplicate-charge alert", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [row({ eventId: "dup-leg-1" })],
      alerts: [
        {
          ...alert({ key: "dup:1" }),
          type: "duplicate",
          evidence: { postingIds: ["dup-leg-1", "dup-leg-2"] },
        },
      ],
      now: NOW,
    });
    expect(queue.items.map((item) => item.kind)).toEqual(["anomaly"]);
  });

  it("keeps an uncategorized row when the alert has no matching posting ids", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [row({ eventId: "e1" })],
      alerts: [
        {
          ...alert({ key: "dup:1" }),
          type: "duplicate",
          evidence: { postingIds: ["other-1", "other-2"] },
        },
      ],
      now: NOW,
    });
    expect(queue.items.map((item) => item.kind)).toEqual([
      "uncategorized",
      "anomaly",
    ]);
  });

  it("keeps same-label overruns from both budget scopes as separate items", () => {
    const queue = buildMorningQueue({
      overruns: [
        overrun({ label: "Other", scope: "personal" }),
        overrun({ label: "Other", scope: "business" }),
      ],
      now: NOW,
    });
    expect(queue.items).toHaveLength(2);
    expect(queue.items[0].detail).toContain("personal");
    expect(queue.items[1].detail).toContain("business");
  });

  it("skips malformed entries instead of throwing", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [null, {}, row({ eventId: "ok" })],
      alerts: [null, { title: "no key" }],
      bills: [{ nextExpectedDate: null }],
      overruns: [{ label: "none", overAmountCents: 0 }],
      now: NOW,
    });
    expect(queue.items.map((item) => item.id)).toEqual(["uncategorized:ok"]);
  });

  it("attaches stable ids, severities, pointers, and payloads", () => {
    const queue = buildMorningQueue({
      ambiguousRows: [row({ eventId: "e9" })],
      alerts: [alert({ key: "k9", severity: "medium" })],
      bills: [bill()],
      overruns: [overrun()],
      now: NOW,
    });
    const byKind = Object.fromEntries(
      queue.items.map((item) => [item.kind, item]),
    );
    expect(byKind.uncategorized.pointer).toBe("/forge/connections");
    expect(byKind.uncategorized.payload.suggestionCategory).toBe("fuel");
    expect(byKind.uncategorized.payload.suggestionConfidence).toBe(0.9);
    expect(byKind.anomaly.severity).toBe("medium");
    expect(byKind.anomaly.payload.alertKey).toBe("k9");
    expect(byKind.bill.payload.nextExpectedDate).toBe("2026-09-22");
    expect(byKind.overrun.payload.overAmountCents).toBe(1033326);
  });
});
