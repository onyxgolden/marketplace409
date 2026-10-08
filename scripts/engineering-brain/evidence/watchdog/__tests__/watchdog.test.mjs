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
  attributionWindow,
} from "../evaluateSlots.mjs";
import { evaluateSlot, runWatchdog, diagnosticPacket } from "../runWatchdog.mjs";
import { getCapability } from "../../../runtimeCoverageRegistry.mjs";

// --- fakes (same shape as the Slice 2/3 fakes, now window-aware) ----------

function fakeSupabase({ rows = [] } = {}) {
  // rows: [{ id, <timeColumn>: ISO }]. Applies gte/lt bounds like the real query.
  // from() returns a FRESH chain per call, like the real client.
  const newChain = () => {
    let headMode = false;
    let gteIso = null;
    let ltIso = null;
    let timeColumn = "started_at";
    const chain = {
      select(cols, opts) { headMode = !!(opts && opts.head); return chain; },
      gte(col, iso) { gteIso = iso; return chain; },
      lt(col, iso) { ltIso = iso; return chain; },
      eq() { return chain; },
      like() { return chain; },
      order(col) { timeColumn = col; return chain; },
      limit() { return chain; },
      then(resolve) {
        const matched = rows.filter((r) =>
          (gteIso === null || r[timeColumn] >= gteIso) && (ltIso === null || r[timeColumn] < ltIso));
        if (headMode) resolve({ data: [], count: matched.length, error: null });
        else {
          const sorted = [...matched].sort((a, b) =>
            (b[timeColumn] || "") < (a[timeColumn] || "") ? -1 : 1);
          resolve({ data: sorted.slice(0, 1), error: null });
        }
      },
    };
    return chain;
  };
  return { from() { return newChain(); } };
}

function fakeGithub({ runs = [] } = {}) {
  return { async listWorkflowRuns() { return runs; } };
}

const sweepDeps = (rows) => ({
  supabase: fakeSupabase({ rows }),
  githubApi: fakeGithub({ runs: [] }),
});

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

function sweepDepsRows(rows) {
  return {
    supabase: fakeSupabase({ rows }),
    githubApi: fakeGithub({ runs: [] }),
  };
}

describe("evaluateSlot", () => {
  const cap = () => getCapability("rental-autopay-sweep");
  // Slot: 2026-10-07 07:30 UTC, grace 3h → window [06:30, 10:30].
  const slot = { capability_id: "rental-autopay-sweep", expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 };

  it("pending: grace has not expired", async () => {
    const early = { ...slot, expected_at: new Date(NOW - 3600000).toISOString() };
    const r = await evaluateSlot(cap(), early, { now: NOW, deps: sweepDepsRows([]), repoRoot: null });
    expect(r.state).toBe("pending");
  });

  it("observed-success: attributable evidence inside the slot window", async () => {
    const r = await evaluateSlot(cap(), slot, {
      now: NOW,
      deps: sweepDepsRows([{ id: "1", started_at: "2026-10-07T08:00:00.000Z" }]),
      repoRoot: null,
    });
    expect(r.state).toBe("observed-success");
  });

  it("does NOT associate a later run with the earlier slot (blocker 1)", async () => {
    // Run at 11:00 belongs to a later slot, not this one.
    const r = await evaluateSlot(cap(), slot, {
      now: NOW,
      deps: sweepDepsRows([{ id: "2", started_at: "2026-10-07T11:00:00.000Z" }]),
      repoRoot: null,
    });
    expect(r.state).toBe("confirmed-miss");
  });

  it("confirmed-miss: execution log healthy but empty for the slot", async () => {
    const r = await evaluateSlot(cap(), slot, { now: NOW, deps: sweepDepsRows([]), repoRoot: null });
    expect(r.state).toBe("confirmed-miss");
  });

  it("ambiguous: business effects cannot confirm a miss", async () => {
    const charges = getCapability("rental-generate-charges");
    const s = { capability_id: "rental-generate-charges", expected_at: "2026-10-07T06:00:00.000Z", grace_hours: 3 };
    const r = await evaluateSlot(charges, s, { now: NOW, deps: sweepDepsRows([]), repoRoot: null });
    expect(r.state).toBe("ambiguous");
  });

  it("ambiguous: evidence adapter failure", async () => {
    const deps = {
      supabase: { from() { throw new Error("down"); } },
      githubApi: fakeGithub({ runs: [] }),
    };
    const r = await evaluateSlot(cap(), slot, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("ambiguous");
  });

  it("configuration-error: registry names a workflow file missing from the repo", async () => {
    const brain = getCapability("brain-nightly-sync");
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const r = await evaluateSlot(brain, s, {
      now: NOW,
      deps: { githubApi: fakeGithub({ runs: [] }) },
      repoRoot: "/nonexistent-repo-root",
    });
    expect(r.state).toBe("configuration-error");
    expect(r.reason).toContain("engineering-brain-sync.yml");
  });

  it("workflow: successful run in window → observed-success", async () => {
    const brain = getCapability("brain-nightly-sync");
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const deps = {
      githubApi: fakeGithub({
        runs: [
          { conclusion: "success", status: "completed", startedAt: "2026-10-07T09:05:00.000Z", htmlUrl: "x" },
          { conclusion: "success", status: "completed", startedAt: "2026-10-06T09:05:00.000Z", htmlUrl: "x" },
        ],
      }),
    };
    const r = await evaluateSlot(brain, s, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("observed-success");
  });

  it("workflow: failed run in window is NOT success (blocker 3)", async () => {
    const brain = getCapability("brain-nightly-sync");
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const deps = {
      githubApi: fakeGithub({
        runs: [{ conclusion: "failure", status: "completed", startedAt: "2026-10-07T09:05:00.000Z", htmlUrl: "x" }],
      }),
    };
    const r = await evaluateSlot(brain, s, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("ambiguous");
    expect(r.reason).toContain("failure");
  });

  it("workflow: history visible but slot empty → confirmed-miss (blocker 2)", async () => {
    const brain = getCapability("brain-nightly-sync");
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const deps = {
      githubApi: fakeGithub({
        runs: [{ conclusion: "success", status: "completed", startedAt: "2026-10-06T09:05:00.000Z", htmlUrl: "x" }],
      }),
    };
    const r = await evaluateSlot(brain, s, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("confirmed-miss");
  });

  it("workflow: no history at all → ambiguous, never confirmed-miss (blocker 2)", async () => {
    const brain = getCapability("brain-nightly-sync");
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const deps = { githubApi: fakeGithub({ runs: [] }) };
    const r = await evaluateSlot(brain, s, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("ambiguous");
  });

  it("workflow: later run is not associated with the earlier slot (blocker 1)", async () => {
    const brain = getCapability("brain-nightly-sync");
    // 09:00 slot; the 10:05 run belongs to the 10:00 slot. The attribution
    // window is midpoint-bounded to [08:00, 09:30], excluding it.
    const s = { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 };
    const deps = {
      githubApi: fakeGithub({
        runs: [{ conclusion: "success", status: "completed", startedAt: "2026-10-07T10:05:00.000Z", htmlUrl: "x" }],
      }),
    };
    const r = await evaluateSlot(brain, s, { now: NOW, deps, repoRoot: null });
    expect(r.state).toBe("confirmed-miss");
  });

  it("attributionWindow: midpoint-bounded for adjacent slots, wide for daily", () => {
    const brain = getCapability("brain-nightly-sync");
    const dual = attributionWindow(brain, { capability_id: "brain-nightly-sync", expected_at: "2026-10-07T09:00:00.000Z", grace_hours: 2 });
    // Next slot 10:00 → midpoint 09:30 bounds the end.
    expect(dual.endIso).toBe("2026-10-07T09:30:00.000Z");
    expect(dual.startIso).toBe("2026-10-07T08:00:00.000Z");

    const sweep = getCapability("rental-autopay-sweep");
    const daily = attributionWindow(sweep, { capability_id: "rental-autopay-sweep", expected_at: "2026-10-07T07:30:00.000Z", grace_hours: 3 });
    // Daily neighbors are 24h away; the default window applies.
    expect(daily.startIso).toBe("2026-10-07T06:30:00.000Z");
    expect(daily.endIso).toBe("2026-10-07T10:30:00.000Z");
  });
});

// --- runner: dedupe + packets --------------------------------------------------

describe("runWatchdog", () => {
  let stateFile;
  beforeEach(() => {
    stateFile = join(mkdtempSync(join(tmpdir(), "watchdog-")), "alerts.json");
  });

  const depsFor = (latestAt) => sweepDeps(latestAt ? [{ id: "1", started_at: latestAt }] : []);

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
