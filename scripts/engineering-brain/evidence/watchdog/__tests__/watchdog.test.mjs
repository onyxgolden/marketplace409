// Watchdog tests (Slice 4). All I/O faked; no network, no repo writes
// except to temp state files.
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chicagoUtcOffsetHours,
  effectiveCronsForDate,
  expectedSlots,
} from "../evaluateSlots.mjs";
import { evaluateSlot, runWatchdog, diagnosticPacket } from "../runWatchdog.mjs";
import { getCapability } from "../../../runtimeCoverageRegistry.mjs";

// --- fakes (same shape as the Slice 2/3 fakes) ---------------------------

function fakeSupabase({ countResult, latestResult } = {}) {
  let headMode = false;
  const chain = {
    select(cols, opts) { headMode = !!(opts && opts.head); return chain; },
    gte() { return chain; },
    eq() { return chain; },
    like() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    then(resolve) { resolve(headMode ? countResult : latestResult); },
  };
  return { from() { return chain; } };
}

function fakeGithub({ runs = [] } = {}) {
  return { async listWorkflowRuns() { return runs; } };
}

const okCount = (n) => ({ data: [], count: n, error: null });
const okLatest = (rows) => ({ data: rows, error: null });

// 2026-10-07 12:00 UTC = 07:00 CDT (October is daylight time).
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
// 2026-01-07 12:00 UTC = 06:00 CST (January is standard time).
const WINTER_NOW = Date.UTC(2026, 0, 7, 12, 0, 0);

// --- slot computation -----------------------------------------------------

describe("chicagoUtcOffsetHours", () => {
  it("returns -5 in daylight time, -6 in standard time", () => {
    expect(chicagoUtcOffsetHours(new Date(NOW))).toBe(-5);
    expect(chicagoUtcOffsetHours(new Date(WINTER_NOW))).toBe(-6);
  });
});

describe("effectiveCronsForDate", () => {
  it("fixed-utc: the single UTC cron every day", () => {
    const c = getCapability("pf-autopay-sweep");
    expect(effectiveCronsForDate(c, new Date(NOW))).toEqual([{ minute: 30, hour: 7 }]);
  });

  it("dual-fire: both UTC slots every day", () => {
    const c = getCapability("brain-nightly-sync");
    expect(effectiveCronsForDate(c, new Date(NOW))).toEqual([
      { minute: 0, hour: 9 },
      { minute: 0, hour: 10 },
    ]);
  });

  it("dst-guarded: earlier slot on CDT days, later slot on CST days", () => {
    const c = getCapability("brain-doc-drift-nightly"); // crons 0 6, 0 7; wall 1:00 AM
    expect(effectiveCronsForDate(c, new Date(NOW))).toEqual([{ minute: 0, hour: 6 }]);
    expect(effectiveCronsForDate(c, new Date(WINTER_NOW))).toEqual([{ minute: 0, hour: 7 }]);
  });

  it("event triggers produce no slots", () => {
    const c = getCapability("rental-autopay-sweep-watchdog");
    expect(effectiveCronsForDate(c, new Date(NOW))).toEqual([]);
  });
});

describe("expectedSlots", () => {
  it("emits past slots most-recent-first with grace hours", () => {
    const c = getCapability("pf-autopay-sweep"); // 30 7 * * *, daily
    const slots = expectedSlots(c, NOW);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    expect(slots[0].capability_id).toBe("pf-autopay-sweep");
    expect(slots[0].grace_hours).toBe(3);
    // Most recent slot: today 07:30 UTC (now is 12:00 UTC).
    expect(slots[0].expected_at).toBe("2026-10-07T07:30:00.000Z");
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i - 1].expected_at > slots[i].expected_at).toBe(true);
    }
  });

  it("dual-fire capabilities get two slots per day", () => {
    const c = getCapability("brain-nightly-sync");
    const slots = expectedSlots(c, NOW);
    const today = slots.filter((s) => s.expected_at.startsWith("2026-10-07"));
    expect(today.map((s) => s.expected_at).sort()).toEqual([
      "2026-10-07T09:00:00.000Z",
      "2026-10-07T10:00:00.000Z",
    ]);
  });
});

// --- slot states ------------------------------------------------------------

function sweepDeps(latestAt, count = 1) {
  return {
    supabase: fakeSupabase({
      countResult: okCount(count),
      latestResult: okLatest(latestAt ? [{ id: "1", started_at: latestAt }] : []),
    }),
    githubApi: fakeGithub({ runs: [] }),
  };
}

describe("evaluateSlot", () => {
  const cap = () => getCapability("rental-autopay-sweep");

  it("pending: grace has not expired", async () => {
    const slot = { capability_id: "rental-autopay-sweep", expected_at: new Date(NOW - 3600000).toISOString(), grace_hours: 3 };
    const r = await evaluateSlot(cap(), slot, { now: NOW, deps: sweepDeps(null, 0), repoRoot: null });
    expect(r.state).toBe("pending");
  });

  it("observed-success: attributable evidence inside the slot window", async () => {
    const slot = { capability_id: "rental-autopay-sweep", expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 };
    const r = await evaluateSlot(cap(), slot, {
      now: NOW,
      deps: sweepDeps("2026-10-07T08:00:00.000Z"),
      repoRoot: null,
    });
    expect(r.state).toBe("observed-success");
  });

  it("confirmed-miss: execution log healthy but empty for the slot", async () => {
    const slot = { capability_id: "rental-autopay-sweep", expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 };
    const r = await evaluateSlot(cap(), slot, { now: NOW, deps: sweepDeps(null, 0), repoRoot: null });
    expect(r.state).toBe("confirmed-miss");
  });

  it("ambiguous: business effects cannot confirm a miss", async () => {
    const charges = getCapability("rental-generate-charges");
    const slot = { capability_id: "rental-generate-charges", expected_at: "2026-10-07T06:00:00.000Z", grace_hours: 3 };
    const deps = {
      supabase: fakeSupabase({ countResult: okCount(0), latestResult: okLatest([]) }),
      githubApi: fakeGithub({ runs: [] }),
    };
    const r = await evaluateSlot(charges, slot, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("ambiguous");
  });

  it("ambiguous: evidence adapter failure", async () => {
    const slot = { capability_id: "rental-autopay-sweep", expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 };
    const deps = {
      supabase: fakeSupabase({
        countResult: { data: null, count: null, error: { message: "down" } },
        latestResult: { data: null, count: null, error: { message: "down" } },
      }),
      githubApi: fakeGithub({ runs: [] }),
    };
    const r = await evaluateSlot(cap(), slot, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("ambiguous");
  });

  it("configuration-error: registry names a workflow file missing from the repo", async () => {
    const brain = getCapability("brain-nightly-sync");
    const slot = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const r = await evaluateSlot(brain, slot, {
      now: NOW,
      deps: { githubApi: fakeGithub({ runs: [] }) },
      repoRoot: "/nonexistent-repo-root",
    });
    expect(r.state).toBe("configuration-error");
    expect(r.reason).toContain("engineering-brain-sync.yml");
  });
});

// --- runner: dedupe + packets --------------------------------------------------

describe("runWatchdog", () => {
  let stateFile;
  beforeEach(() => {
    stateFile = join(mkdtempSync(join(tmpdir(), "watchdog-")), "alerts.json");
  });

  const depsFor = (latestAt) => sweepDeps(latestAt, latestAt ? 1 : 0);

  it("alerts once per slot and does not re-alert on repeat runs", async () => {
    const deps = depsFor(null); // primary sweep missed
    const first = await runWatchdog({ now: NOW, deps, repoRoot: null, stateFile });
    const sweepAlerts = first.alerts.filter((a) => a.capability_id === "rental-autopay-sweep");
    expect(sweepAlerts.length).toBe(1);
    expect(sweepAlerts[0].state).toBe("confirmed-miss");

    const second = await runWatchdog({ now: NOW, deps, repoRoot: null, stateFile });
    expect(second.alerts.filter((a) => a.capability_id === "rental-autopay-sweep").length).toBe(0);
    expect(second.summary.new_alerts).toBeLessThanOrEqual(first.summary.new_alerts);
  });

  it("resolves an alert when the slot later shows success", async () => {
    await runWatchdog({ now: NOW, deps: depsFor(null), repoRoot: null, stateFile });
    const later = await runWatchdog({
      now: NOW,
      deps: depsFor("2026-10-07T08:00:00.000Z"),
      repoRoot: null,
      stateFile,
    });
    expect(later.resolved.some((k) => k.startsWith("rental-autopay-sweep|"))).toBe(true);
    expect(later.alerts.filter((a) => a.capability_id === "rental-autopay-sweep").length).toBe(0);
  });

  it("persists alert state to the state file", async () => {
    await runWatchdog({ now: NOW, deps: depsFor(null), repoRoot: null, stateFile });
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const keys = Object.keys(state).filter((k) => k.startsWith("rental-autopay-sweep|"));
    expect(keys.length).toBe(1);
    expect(state[keys[0]].resolved_at).toBeNull();
  });
});

describe("diagnosticPacket", () => {
  it("contains evidence, recovery guidance, and no credentials", () => {
    const cap = getCapability("rental-autopay-sweep");
    const slot = { capability_id: cap.id, expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 };
    const evaluation = { state: "confirmed-miss", reason: "no attributable evidence", evidence_summary: [] };
    const p = diagnosticPacket(cap, slot, evaluation, NOW);
    expect(p.capability_id).toBe("rental-autopay-sweep");
    expect(p.state).toBe("confirmed-miss");
    expect(p.recovery.note).toContain("never refires");
    expect(p.recovery.execution_path).toBe(cap.execution_path);
    expect(JSON.stringify(p)).not.toContain("CRON_SECRET");
    expect(JSON.stringify(p).toLowerCase()).not.toContain("bearer");
  });
});
