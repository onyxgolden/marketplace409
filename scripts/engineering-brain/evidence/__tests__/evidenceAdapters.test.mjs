// Evidence adapter tests (Slice 2). All I/O is faked; no network.
import { describe, expect, it } from "vitest";

import { ADAPTER_TYPES } from "../adapterTypes.mjs";
import {
  ADAPTER_SPECS,
  UNSPECIFIED_CAPABILITIES,
  getAdapterSpec,
  validateAdapterSpecs,
} from "../evidenceAdapters.mjs";
import { collectEvidence } from "../collectEvidence.mjs";
import { CAPABILITIES } from "../../runtimeCoverageRegistry.mjs";

// --- fakes ---------------------------------------------------------------

// Thenable select chain modeling the real client: `await` resolves the
// query. Head-mode (count) queries resolve countResult; row queries
// resolve latestResult. Write methods exist so tests can prove they are
// never used.
function fakeSupabase({ countResult, latestResult, calls = [] } = {}) {
  let headMode = false;
  const chain = {
    select(cols, opts) { calls.push(["select", cols]); headMode = !!(opts && opts.head); return chain; },
    gte(col, val) { calls.push(["gte", col, val]); return chain; },
    order(col, opts) { calls.push(["order", col]); return chain; },
    limit(n) { calls.push(["limit", n]); return chain; },
    then(resolve) { resolve(headMode ? countResult : latestResult); },
    insert() { calls.push(["insert"]); return chain; },
    update() { calls.push(["update"]); return chain; },
    delete() { calls.push(["delete"]); return chain; },
    rpc() { calls.push(["rpc"]); return chain; },
  };
  return { from(table) { calls.push(["from", table]); return chain; } };
}

const okCount = (n) => ({ data: [], count: n, error: null });
const okLatest = (rows) => ({ data: rows, error: null });
const dbError = (message) => ({ data: null, count: null, error: { message } });
const ROWS = [
  { id: "2", started_at: "2026-10-07T08:23:00Z" },
  { id: "1", started_at: "2026-10-06T08:23:00Z" },
];
const depsFor = (over = {}) => ({
  supabase: fakeSupabase({
    countResult: okCount(ROWS.length),
    latestResult: okLatest(ROWS),
    ...over,
  }),
});

function fakeGithub({ runs = [], throws = null, calls = [] } = {}) {
  return {
    // read-only contract: only listWorkflowRuns (GET) exists on the fake
    async listWorkflowRuns(workflowFile) {
      calls.push(["listWorkflowRuns", workflowFile]);
      if (throws) throw throws;
      return runs;
    },
  };
}

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

// --- spec validation -----------------------------------------------------

describe("adapter specs", () => {
  it("validate clean", () => {
    const { ok, errors } = validateAdapterSpecs();
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it("every registry capability is either specified or explicitly unspecified", () => {
    const specified = new Set(ADAPTER_SPECS.map((s) => s.capability_id));
    const unspecified = new Set(UNSPECIFIED_CAPABILITIES.map((u) => u.capability_id));
    for (const c of CAPABILITIES) {
      expect(
        specified.has(c.id) || unspecified.has(c.id),
        `${c.id} has neither adapters nor an honest absence note`
      ).toBe(true);
      expect(specified.has(c.id) && unspecified.has(c.id)).toBe(false);
    }
  });

  it("capabilities with only unverified evidence have no adapters (uncertainty not upgraded)", () => {
    const allUnverified = (c) =>
      c.durable_evidence.every((e) => e.toLowerCase().startsWith("unverified"));
    for (const c of CAPABILITIES.filter(allUnverified)) {
      expect(getAdapterSpec(c.id), `${c.id} has unverified evidence but got adapters`).toBeUndefined();
    }
    // The watchdog's trigger is unable-to-verify, but its evidence table is
    // real — it keeps its adapter. Uncertainty stays exactly where it is.
    expect(getAdapterSpec("rental-autopay-sweep-watchdog")).toBeDefined();
  });
});

// --- supabase-table adapter ----------------------------------------------

describe("supabase-table adapter", () => {
  const spec = { type: "supabase-table", table: "rental_sweep_runs", timeColumn: "started_at", windowHours: 36 };

  it("returns the exact row count and latest time from the fake", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](spec, depsFor(), NOW);
    expect(r.ok).toBe(true);
    expect(r.evidence.rowCount).toBe(2);
    expect(r.evidence.latestAt).toBe("2026-10-07T08:23:00Z");
    expect(r.evidence.source).toBe("supabase:rental_sweep_runs");
  });

  it("reports zero rows as evidence, not as failure", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ countResult: okCount(0), latestResult: okLatest([]) }),
      NOW
    );
    expect(r.ok).toBe(true);
    expect(r.evidence.rowCount).toBe(0);
    expect(r.evidence.latestAt).toBeNull();
  });

  it("fails closed on a database error", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ countResult: dbError("column does not exist"), latestResult: dbError("column does not exist") }),
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rental_sweep_runs");
  });

  it("fails closed without a client, and never throws", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](spec, {}, NOW);
    expect(r.ok).toBe(false);
  });

  it("fails closed when the count response is malformed (no silent zero)", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ countResult: { data: [], error: null } }),
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("malformed");
  });

  it("fails closed when the latest-row data is not an array (no silent zero rows)", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ latestResult: { data: "oops", error: null } }),
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not an array");
  });

  it("fails closed when the latest row lacks a usable time column", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ countResult: okCount(1), latestResult: okLatest([{ id: "1" }]) }),
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("started_at");
  });

  it("fails closed when count and latest row disagree", async () => {
    const r = await ADAPTER_TYPES["supabase-table"](
      spec,
      depsFor({ countResult: okCount(2), latestResult: okLatest([]) }),
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("inconsistent");
  });

  it("is read-only: only select-chain methods are ever called", async () => {
    const calls = [];
    await ADAPTER_TYPES["supabase-table"](
      spec,
      { supabase: fakeSupabase({ calls, countResult: okCount(0), latestResult: okLatest([]) }) },
      NOW
    );
    const verbs = calls.map((c) => c[0]);
    expect(verbs).not.toContain("insert");
    expect(verbs).not.toContain("update");
    expect(verbs).not.toContain("delete");
    expect(verbs).not.toContain("rpc");
    expect(verbs).toContain("select");
  });

  it("queries the window relative to the injected now (deterministic)", async () => {
    const calls = [];
    await ADAPTER_TYPES["supabase-table"](
      spec,
      { supabase: fakeSupabase({ calls, countResult: okCount(0), latestResult: okLatest([]) }) },
      NOW
    );
    const gtes = calls.filter((c) => c[0] === "gte");
    expect(gtes.length).toBe(2); // count query + latest-row query
    for (const gte of gtes) {
      expect(gte[2]).toBe(new Date(NOW - 36 * 3600 * 1000).toISOString());
    }
  });
});

// --- github-actions adapter ----------------------------------------------

describe("github-actions adapter", () => {
  const spec = { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" };

  it("returns the latest run", async () => {
    const runs = [
      { conclusion: "success", status: "completed", startedAt: "2026-10-07T08:23:00Z", htmlUrl: "https://x/1" },
    ];
    const r = await ADAPTER_TYPES["github-actions"](spec, { githubApi: fakeGithub({ runs }) }, NOW);
    expect(r.ok).toBe(true);
    expect(r.evidence.latest.conclusion).toBe("success");
  });

  it("reports no runs as evidence, not failure", async () => {
    const r = await ADAPTER_TYPES["github-actions"](spec, { githubApi: fakeGithub({ runs: [] }) }, NOW);
    expect(r.ok).toBe(true);
    expect(r.evidence.latest).toBeNull();
  });

  it("fails closed on a malformed run", async () => {
    const r = await ADAPTER_TYPES["github-actions"](
      spec,
      { githubApi: fakeGithub({ runs: [{ status: "completed" }] }) },
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("conclusion");
  });

  it("fails closed when the api throws, never propagates", async () => {
    const r = await ADAPTER_TYPES["github-actions"](
      spec,
      { githubApi: fakeGithub({ throws: new Error("rate limited") }) },
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rate limited");
  });
});

// --- collectEvidence ------------------------------------------------------

describe("collectEvidence", () => {
  const fullDeps = () => ({
    supabase: fakeSupabase({ countResult: okCount(1), latestResult: okLatest([{ id: "1", started_at: "2026-10-07T08:23:00Z" }]) }),
    githubApi: fakeGithub({ runs: [{ conclusion: "success", status: "completed", startedAt: "2026-10-07T08:23:00Z" }] }),
  });

  it("collects all adapters for a capability", async () => {
    const r = await collectEvidence("rental-autopay-sweep", { now: NOW, deps: fullDeps() });
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results.every((x) => x.ok)).toBe(true);
  });

  it("fails the collection when one adapter fails, preserving per-adapter results", async () => {
    const deps = {
      supabase: fakeSupabase({ countResult: dbError("boom"), latestResult: dbError("boom") }),
      githubApi: fakeGithub({ runs: [] }),
    };
    const r = await collectEvidence("rental-autopay-sweep", { now: NOW, deps });
    expect(r.ok).toBe(false);
    expect(r.results).toHaveLength(2);
    expect(r.results.filter((x) => !x.ok)).toHaveLength(1);
  });

  it("rejects an unknown capability", async () => {
    const r = await collectEvidence("nope", { now: NOW, deps: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown capability");
  });

  it("honestly reports capabilities with no adapters", async () => {
    const r = await collectEvidence("stripe-rental-payment-webhook", { now: NOW, deps: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no evidence adapters");
  });

  it("is deterministic for the same fake inputs", async () => {
    const a = await collectEvidence("rental-autopay-sweep", { now: NOW, deps: fullDeps() });
    const b = await collectEvidence("rental-autopay-sweep", { now: NOW, deps: fullDeps() });
    expect(a).toEqual(b);
  });
});
