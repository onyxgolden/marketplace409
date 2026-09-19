import { describe, expect, test } from "vitest";
import { detectAnomalies, alertKeyOf } from "../anomalies.js";

// Anchor every test to a fixed "now" so relative windows are deterministic.
const NOW = "2026-09-19";

function posting(overrides) {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    description: "GENERIC MERCHANT",
    amount: 10,
    categoryFamily: null,
    date: "2026-09-10",
    ...overrides,
  };
}

// Six baseline months (Mar-Aug 2026): `perMonth` dollars of spend for `family`,
// split into 2 postings per month on days 5/20 -- every same-amount gap is
// >= 15 days, so the duplicate rule stays quiet in these fixtures.
function baselineSpend(family, perMonth, description = "STEADY SPEND") {
  const postings = [];
  const each = perMonth / 2;
  for (let month = 3; month <= 8; month += 1) {
    for (const day of [5, 20]) {
      postings.push(
        posting({
          id: `${family}-${month}-${day}`,
          description,
          amount: each,
          categoryFamily: family,
          date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        }),
      );
    }
  }
  return postings;
}

describe("detectAnomalies", () => {
  test("flags a category that doubles in the trailing 30 days, with evidence", () => {
    const postings = [
      ...baselineSpend("dining_drinks", 200, "RESTAURANT BILLS"),
      posting({
        id: "spike-1",
        description: "RESTAURANT BILLS",
        amount: 200,
        categoryFamily: "dining_drinks",
        date: "2026-09-05",
      }),
      posting({
        id: "spike-2",
        description: "RESTAURANT BILLS",
        amount: 250,
        categoryFamily: "dining_drinks",
        date: "2026-09-12",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    const spike = alerts.find((alert) => alert.type === "spend-spike");

    expect(spike).toBeDefined();
    expect(spike.severity).toBe("high"); // 2.25x the baseline mean
    expect(spike.evidence.baselineMean).toBe(200);
    expect(spike.evidence.baselineStd).toBe(0);
    expect(spike.evidence.trailing30Days).toBe(450);
    expect(spike.evidence.multiple).toBeCloseTo(2.25, 5);
  });

  test("flags two identical charges 3 days apart as a possible duplicate", () => {
    const postings = [
      posting({
        id: "shell-1",
        description: "SHELL OIL 57444123",
        amount: 42.1,
        categoryFamily: "fuel",
        date: "2026-09-10",
      }),
      posting({
        id: "shell-2",
        description: "SHELL OIL 57444299",
        amount: 42.1,
        categoryFamily: "fuel",
        date: "2026-09-13",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("duplicate");
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].evidence.postingIds).toEqual(["shell-1", "shell-2"]);
    expect(alerts[0].evidence.dates).toEqual(["2026-09-10", "2026-09-13"]);
  });

  test("does not flag same-merchant same-amount charges 8 days apart", () => {
    const postings = [
      posting({
        id: "heb-1",
        description: "HEB GROCERY #412",
        amount: 100,
        categoryFamily: "groceries",
        date: "2026-09-01",
      }),
      posting({
        id: "heb-2",
        description: "HEB GROCERY #412",
        amount: 100,
        categoryFamily: "groceries",
        date: "2026-09-09",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    expect(alerts.filter((alert) => alert.type === "duplicate")).toHaveLength(0);
  });

  test("flags a recurring pattern whose latest amount drifted >10%", () => {
    const alerts = detectAnomalies({
      postings: [],
      recurringPatterns: [
        {
          label: "Gym",
          medianAmount: 50,
          latestAmount: 65,
          latestDate: "2026-09-01",
          cadence: "monthly",
        },
      ],
      now: NOW,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("recurring-drift");
    expect(alerts[0].severity).toBe("medium");
    expect(alerts[0].evidence.pctChange).toBe(30);
    expect(alerts[0].evidence.medianAmount).toBe(50);
    expect(alerts[0].evidence.latestAmount).toBe(65);
  });

  test("ignores recurring drift within 10%", () => {
    const alerts = detectAnomalies({
      postings: [],
      recurringPatterns: [
        {
          label: "Gym",
          medianAmount: 50,
          latestAmount: 52,
          latestDate: "2026-09-01",
          cadence: "monthly",
        },
      ],
      now: NOW,
    });

    expect(alerts).toHaveLength(0);
  });

  test("notes a first-time large outflow as a low-severity new payee", () => {
    const postings = [
      posting({
        id: "old-1",
        description: "ACME SUPPLY CO",
        amount: 200,
        categoryFamily: "shopping",
        date: "2026-05-01",
      }),
      posting({
        id: "new-1",
        description: "NEWMERCHANT SERVICES",
        amount: 800,
        categoryFamily: "shopping",
        date: "2026-09-10",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    const note = alerts.find((alert) => alert.type === "new-payee");

    expect(note).toBeDefined();
    expect(note.severity).toBe("low");
    expect(note.evidence.merchant).toBe("newmerchant");
    expect(note.evidence.amount).toBe(800);
    expect(note.evidence.date).toBe("2026-09-10");
  });

  test("does not flag a large outflow to a previously seen merchant", () => {
    const postings = [
      posting({
        id: "old-1",
        description: "ACME SUPPLY CO",
        amount: 600,
        categoryFamily: "shopping",
        date: "2026-04-15",
      }),
      posting({
        id: "new-1",
        description: "ACME SUPPLY CO",
        amount: 800,
        categoryFamily: "shopping",
        date: "2026-09-10",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    expect(alerts.filter((alert) => alert.type === "new-payee")).toHaveLength(0);
  });

  test("clean history produces no alerts", () => {
    const postings = [
      ...baselineSpend("groceries", 300, "HEB GROCERY #412"),
      posting({
        id: "sep-1",
        description: "HEB GROCERY #412",
        amount: 100,
        categoryFamily: "groceries",
        date: "2026-09-05",
      }),
      posting({
        id: "sep-2",
        description: "HEB GROCERY #412",
        amount: 100,
        categoryFamily: "groceries",
        date: "2026-09-15",
      }),
    ];

    expect(detectAnomalies({ postings, now: NOW })).toEqual([]);
  });

  test("tiny-category noise stays under the $50 minimum", () => {
    const postings = [
      ...baselineSpend("coffee", 2, "COFFEE CART"),
      posting({
        id: "tiny-1",
        description: "COFFEE CART",
        amount: 5,
        categoryFamily: "coffee",
        date: "2026-09-10",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    expect(alerts.filter((alert) => alert.type === "spend-spike")).toHaveLength(0);
  });

  test("skips the spike rule when the baseline is too short", () => {
    const postings = [
      posting({
        id: "only-1",
        description: "NEW CATEGORY SPEND",
        amount: 60,
        categoryFamily: "brand_new",
        date: "2026-08-10",
      }),
      posting({
        id: "only-2",
        description: "NEW CATEGORY SPEND",
        amount: 400,
        categoryFamily: "brand_new",
        date: "2026-09-10",
      }),
    ];

    const alerts = detectAnomalies({ postings, now: NOW });
    expect(alerts.filter((alert) => alert.type === "spend-spike")).toHaveLength(0);
  });

  test("never throws on empty or missing input", () => {
    expect(detectAnomalies()).toEqual([]);
    expect(detectAnomalies({})).toEqual([]);
    expect(detectAnomalies({ postings: null, recurringPatterns: null })).toEqual([]);
    expect(detectAnomalies({ postings: [{ bogus: true }] })).toEqual([]);
  });

  test("ranks high severity before medium before low", () => {
    const postings = [
      ...baselineSpend("dining_drinks", 200, "RESTAURANT BILLS"),
      posting({
        id: "spike-1",
        description: "RESTAURANT BILLS",
        amount: 450,
        categoryFamily: "dining_drinks",
        date: "2026-09-10",
      }),
      posting({
        id: "new-1",
        description: "NEWMERCHANT SERVICES",
        amount: 800,
        categoryFamily: "shopping",
        date: "2026-09-10",
      }),
    ];

    const alerts = detectAnomalies({
      postings,
      recurringPatterns: [
        {
          label: "Gym",
          medianAmount: 50,
          latestAmount: 65,
          latestDate: "2026-09-01",
          cadence: "monthly",
        },
      ],
      now: NOW,
    });

    const severities = alerts.map((alert) => alert.severity);
    expect(severities).toEqual(["high", "medium", "low"]);
  });
});

describe("alertKeyOf", () => {
  const alert = {
    type: "duplicate",
    severity: "high",
    title: "Possible duplicate charge: shell",
    detail: "x",
    evidence: { merchant: "shell", amount: 45.2, postingIds: ["a", "b"], dates: ["2026-09-10", "2026-09-11"] },
  };

  test("stable across recomputations and key order", () => {
    const shuffled = {
      ...alert,
      evidence: { dates: ["2026-09-10", "2026-09-11"], amount: 45.2, postingIds: ["a", "b"], merchant: "shell" },
    };
    expect(alertKeyOf(alert)).toBe(alertKeyOf(shuffled));
    expect(alertKeyOf(alert)).toMatch(/^duplicate:[0-9a-f]{8}$/);
  });

  test("different evidence yields different keys", () => {
    const other = { ...alert, evidence: { ...alert.evidence, amount: 99.99 } };
    expect(alertKeyOf(other)).not.toBe(alertKeyOf(alert));
  });

  test("never throws on junk input", () => {
    expect(alertKeyOf(null)).toMatch(/^unknown:[0-9a-f]{8}$/);
    expect(typeof alertKeyOf(undefined)).toBe("string");
    expect(typeof alertKeyOf({})).toBe("string");
  });
});
