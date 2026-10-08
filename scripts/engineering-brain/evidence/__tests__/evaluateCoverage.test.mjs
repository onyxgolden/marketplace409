// Coverage evaluator tests (Slice 3). All I/O faked; no network.
import { describe, expect, it } from "vitest";

import { evaluateCapability, evaluateAll } from "../evaluateCoverage.mjs";

function fakeSupabase({ countResult, latestResult, calls = [] } = {}) {
  let headMode = false;
  const chain = {
    select(cols, opts) { calls.push(["select", cols]); headMode = !!(opts && opts.head); return chain; },
    gte(col, val) { calls.push(["gte", col, val]); return chain; },
    eq(col, val) { calls.push(["eq", col, val]); return chain; },
    like(col, val) { calls.push(["like", col, val]); return chain; },
    order(col) { calls.push(["order", col]); return chain; },
    limit(n) { calls.push(["limit", n]); return chain; },
    then(resolve) { resolve(headMode ? countResult : latestResult); },
  };
  return { from(table) { calls.push(["from", table]); return chain; } };
}

function fakeGithub({ runs = [] } = {}) {
  return { async listWorkflowRuns() { return runs; } };
}

const okCount = (n) => ({ data: [], count: n, error: null });
const okLatest = (rows) => ({ data: rows, error: null });
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const twoHoursAgo = new Date(NOW - 2 * 3600 * 1000).toISOString();
const fortyHoursAgo = new Date(NOW - 40 * 3600 * 1000).toISOString();

function sweepDeps(latestAt, count = 1) {
  return {
    supabase: fakeSupabase({
      countResult: okCount(count),
      latestResult: okLatest(latestAt ? [{ id: "1", started_at: latestAt }] : []),
    }),
    githubApi: fakeGithub({ runs: [] }),
  };
}

describe("evaluateCapability", () => {
  it("covered: attributable sweep execution inside the interval", async () => {
    const r = await evaluateCapability("rental-autopay-sweep", { now: NOW, deps: sweepDeps(twoHoursAgo) });
    expect(r.verdict).toBe("covered");
    expect(r.reason).toContain("attributable execution");
  });

  it("gap: attributable source exists but nothing ran recently", async () => {
    const r = await evaluateCapability("rental-autopay-sweep", { now: NOW, deps: sweepDeps(fortyHoursAgo) });
    expect(r.verdict).toBe("gap");
    expect(r.reason).toContain("40.0h ago");
  });

  it("gap: zero attributable rows is a gap, not unknown", async () => {
    const r = await evaluateCapability("rental-autopay-sweep", { now: NOW, deps: sweepDeps(null, 0) });
    expect(r.verdict).toBe("gap");
  });

  it("unknown: adapter failure is unknown, never gap", async () => {
    const deps = {
      supabase: fakeSupabase({
        countResult: { data: null, count: null, error: { message: "boom" } },
        latestResult: { data: null, count: null, error: { message: "boom" } },
      }),
      githubApi: fakeGithub({ runs: [] }),
    };
    const r = await evaluateCapability("rental-autopay-sweep", { now: NOW, deps });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("evidence unavailable");
  });

  it("unknown: corroborating-only evidence can never produce covered", async () => {
    // rental-settlement-reconciliation has only unverified + corroborating
    // sources — even a green shared workflow must not cover it.
    const deps = {
      supabase: fakeSupabase({
        countResult: okCount(5),
        latestResult: okLatest([{ id: "1", created_at: twoHoursAgo }]),
      }),
      githubApi: fakeGithub({
        runs: [{ conclusion: "success", status: "completed", startedAt: twoHoursAgo }],
      }),
    };
    const r = await evaluateCapability("rental-settlement-reconciliation", { now: NOW, deps });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("no attributable evidence source");
    expect(r.corroborating.length).toBeGreaterThan(0);
  });

  it("covered: workflow-exclusive run proves the brain workflow", async () => {
    const deps = {
      supabase: fakeSupabase({ countResult: okCount(0), latestResult: okLatest([]) }),
      githubApi: fakeGithub({
        runs: [{ conclusion: "success", status: "completed", startedAt: twoHoursAgo }],
      }),
    };
    const r = await evaluateCapability("brain-nightly-sync", { now: NOW, deps });
    expect(r.verdict).toBe("covered");
  });

  it("gap: failed workflow run is a gap for the workflow-exclusive capability", async () => {
    const deps = {
      githubApi: fakeGithub({
        runs: [{ conclusion: "failure", status: "completed", startedAt: twoHoursAgo }],
      }),
    };
    const r = await evaluateCapability("brain-nightly-sync", { now: NOW, deps });
    expect(r.verdict).toBe("gap");
  });

  it("unknown: capability with no adapters", async () => {
    const r = await evaluateCapability("stripe-rental-payment-webhook", { now: NOW, deps: {} });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("no evidence adapters");
  });

  it("unknown: unknown capability id", async () => {
    const r = await evaluateCapability("nope", { now: NOW, deps: {} });
    expect(r.verdict).toBe("unknown");
  });
});

describe("evaluateAll", () => {
  it("returns one verdict per registry capability", async () => {
    const results = await evaluateAll({ now: NOW, deps: {} });
    expect(results.length).toBe(21);
    for (const r of results) {
      expect(["covered", "gap", "unknown"]).toContain(r.verdict);
      expect(typeof r.reason).toBe("string");
    }
  });

  it("with no deps, everything is unknown (fail-closed, never covered)", async () => {
    const results = await evaluateAll({ now: NOW, deps: {} });
    expect(results.every((r) => r.verdict === "unknown")).toBe(true);
    expect(results.some((r) => r.verdict === "covered")).toBe(false);
  });
});
