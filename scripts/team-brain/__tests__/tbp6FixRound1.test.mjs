// Team Brain P6 FIX ROUND 1 partners — one describe per ChatGPT
// finding TBP6-001..007 (verdict 2026-10-31). Each test names the
// counterexample it closes; a test that cannot fail on the old code
// is not a partner and does not belong here.
//
// The engine under test binds every run to a principal + settings,
// resumes crashed attempts from the binding, treats MISSED as
// terminal, supersedes stale CONFLICT_FREE facts, keys duplicates by
// typed identity, derives authority from the DB connection user,
// and enforces trusted budget maxima with INCOMPLETE continuation.

import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import {
  createConsolidationEngine,
  migrateP6,
} from "../consolidation/engine.mjs";
import { P6_CODES } from "../consolidation/errors.mjs";
import {
  civilDateInChicago,
  slotInstantForCivilDate,
} from "../consolidation/scheduling.mjs";
import {
  createRetrievalRepository,
  migrate as migrateP5,
} from "../retrieval/repository.mjs";

const it30 = (name, fn) => it(name, fn, 30000);

function expectTeamBrainError(promise, code) {
  return expect(promise).rejects.toMatchObject({ name: "TeamBrainError", code });
}

const NOW_1031 = "2026-10-31T16:00:00Z";
const RUN_1031 = "2026-10-31";
const SRC = {
  repo: "onyxgolden/forge-ai-drop",
  path: "commands/chatgpt/x.md",
  commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blob: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  watermark: "main@fixture",
};

const FR1_TABLES = [
  "tb_episodes",
  "tb_episode_grants",
  "tb_episode_events",
  "tb_retrieval_revisions",
  "tb_working_set",
  "tb_pins",
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_audit",
  "tb_consolidation_run_bindings",
];

const episode = (overrides) => ({
  title: "Episode",
  body: "A fact worth consolidating.",
  scope: "queue",
  visibility: "public",
  grants: [],
  source: { ...SRC },
  capturedAt: "2026-10-15T16:00:00Z",
  ...overrides,
});

async function truncateAll(db) {
  await db.query(
    `TRUNCATE tb_consolidated_facts, tb_consolidation_proposals,
      tb_consolidation_checkpoints, tb_consolidation_audit,
      tb_consolidation_runs, tb_consolidation_run_bindings,
      tb_working_set, tb_episode_grants,
      tb_pins, tb_episode_events, tb_episodes CASCADE`,
  );
  await db.query("UPDATE tb_retrieval_revisions SET revision = 0 WHERE id = 1");
  await db.query(
    "UPDATE tb_consolidation_lease SET holder = NULL, run_date = NULL, acquired_at = NULL, generation = 0 WHERE id = 1",
  );
}

async function countRows(db, table) {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function prepareBatteryRole(db) {
  await db.query("CREATE ROLE tb_consolidator NOLOGIN");
  await db.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ${FR1_TABLES.join(", ")} TO tb_consolidator`,
  );
  await db.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tb_consolidator");
  await db.query("SET ROLE tb_consolidator");
}

async function auditTypes(db, runDate) {
  const { rows } = await db.query(
    "SELECT entry_type FROM tb_consolidation_audit WHERE run_date = $1 ORDER BY seq ASC",
    [runDate],
  );
  return rows.map((r) => r.entry_type);
}

async function auditPayloads(db, runDate, entryType) {
  const { rows } = await db.query(
    "SELECT payload FROM tb_consolidation_audit WHERE run_date = $1 AND entry_type = $2 ORDER BY seq ASC",
    [runDate, entryType],
  );
  return rows.map((r) => JSON.parse(r.payload));
}

async function factStates(db) {
  const { rows } = await db.query(
    "SELECT state, COUNT(*)::int AS n FROM tb_consolidated_facts GROUP BY state ORDER BY state",
  );
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

// ---------------------------------------------------------------- 001

describe("Fix round 1 — TBP6-001 principal binding", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a completed run replays only to its own principal", async () => {
    // Counterexample: a denied principal received the stored
    // receipt with restricted episode IDs. Now the replay refuses.
    await repo.captureEpisode(
      episode({ title: "Restricted", visibility: "restricted", grants: ["alice"] }),
    );
    const first = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "alice",
      now: NOW_1031,
    });
    expect(first.replayed).toBe(false);
    const same = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "alice",
      now: NOW_1031,
    });
    expect(same.replayed).toBe(true);
    expect(same.receiptId).toBe(first.receiptId);
    const factsBefore = await countRows(db, "tb_consolidated_facts");
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, principal: "bob", now: NOW_1031 }),
      P6_CODES.PRINCIPAL_MISMATCH,
    );
    // The refused replay wrote nothing.
    expect(await countRows(db, "tb_consolidated_facts")).toBe(factsBefore);
    expect(await countRows(db, "tb_consolidation_runs")).toBe(1);
  });

  it30("a denied principal's run archives nothing from another principal", async () => {
    // Counterexample: apply reverify archived denied facts and
    // reported their IDs. Now the archive join excludes them.
    await repo.captureEpisode(
      episode({ title: "Alice fact", visibility: "restricted", grants: ["alice"] }),
    );
    const aliceRun = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "alice",
      now: NOW_1031,
    });
    expect(aliceRun.counts.factsPromoted).toBe(4);
    await repo.archiveEpisode(aliceRun.selection.episodeIds[0], { note: "Retired.", actor: "test" });
    // Bob's next-day run must not touch Alice's facts.
    const bobRun = await engine.runConsolidation({
      runDate: "2026-11-01",
      principal: "bob",
      now: "2026-11-01T16:00:00Z",
    });
    expect(bobRun.counts.factsArchived).toBe(0);
    expect(bobRun.counts.factsSuperseded).toBe(0);
    expect(await factStates(db)).toEqual({ ACTIVE: 4 });
  });

  it30("receipt and audit reads are principal-bound, with no implicit reader", async () => {
    await repo.captureEpisode(episode({ title: "Bound read" }));
    await engine.runConsolidation({ runDate: RUN_1031, principal: "alice", now: NOW_1031 });
    await expectTeamBrainError(
      engine.getRunReceipt(RUN_1031, { principal: "bob" }),
      P6_CODES.PRINCIPAL_MISMATCH,
    );
    await expectTeamBrainError(
      engine.exportAudit(RUN_1031, { principal: "bob" }),
      P6_CODES.PRINCIPAL_MISMATCH,
    );
    await expectTeamBrainError(engine.getRunReceipt(RUN_1031), P6_CODES.INVALID_FIELD);
    await expectTeamBrainError(engine.exportAudit(RUN_1031), P6_CODES.INVALID_FIELD);
    const receipt = await engine.getRunReceipt(RUN_1031, { principal: "alice" });
    expect(receipt.principal).toBe("alice");
    const exported = await engine.exportAudit(RUN_1031, { principal: "alice" });
    expect(exported.runDate).toBe(RUN_1031);
    expect(exported.entries.length).toBeGreaterThan(0);
  });

  it30("a MISSED audit export carries no episode data and any principal may read it", async () => {
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "alice",
      now: "2026-10-30T16:00:00Z",
    });
    // Nov 1's run marks Oct 31 MISSED.
    await engine.runConsolidation({
      runDate: "2026-11-01",
      principal: "alice",
      now: "2026-11-01T16:00:00Z",
    });
    const exported = await engine.exportAudit("2026-10-31", { principal: "anyone" });
    expect(exported.state).toBe("MISSED");
    expect(exported.entries.map((e) => e.entryType)).toEqual(["RUN_MISSED"]);
    expect(JSON.stringify(exported)).not.toContain("ep-");
  });
});

// ---------------------------------------------------------------- 002

describe("Fix round 1 — TBP6-002 restart fences", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("crash after SNAPSHOT plus a new capture resumes the bound snapshot", async () => {
    // ChatGPT's counterexample, verbatim shape: capture one episode,
    // crash in selection, capture a second, retry. Old code bound the
    // receipt to revision 2 / count 2 with two SNAPSHOT payloads.
    await repo.captureEpisode(episode({ title: "Before crash" }));
    let crashed = false;
    const crashHandle = {
      query: async (sql, params) => {
        if (!crashed && sql.includes("e.scope, e.title, e.body")) {
          crashed = true;
          throw new Error("injected crash in selection");
        }
        return db.query(sql, params);
      },
    };
    const crashEngine = createConsolidationEngine(crashHandle);
    await expect(crashEngine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    })).rejects.toThrow("injected crash in selection");
    await repo.captureEpisode(episode({ title: "After crash" }));
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.replayed).toBe(false);
    // One bound snapshot: the pre-crash revision and count, not the
    // post-crash store.
    expect(receipt.snapshot.episodeCount).toBe(1);
    expect(receipt.snapshot.revision).toBe(1);
    const snapshots = await auditPayloads(db, RUN_1031, "SNAPSHOT");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].episodeCount).toBe(1);
    expect(snapshots[0].revision).toBe(1);
    const checkpoints = await db.query(
      "SELECT counts FROM tb_consolidation_checkpoints WHERE run_date = $1 AND checkpoint = 'SNAPSHOT'",
      [RUN_1031],
    );
    expect(checkpoints.rows).toHaveLength(1);
    expect(JSON.parse(checkpoints.rows[0].counts).revision).toBe(1);
    // The retry still selected only the bound episode.
    expect(receipt.selection.total).toBe(1);
  });

  it30("a missing RUN_COMPLETED audit row is reconciled, never duplicated", async () => {
    // ChatGPT's second counterexample shape: COMPLETED row persisted
    // with the terminal audit lost. Replay must repair it to exactly
    // one row, not leave zero forever and not duplicate it.
    await repo.captureEpisode(episode({ title: "Reconcile me" }));
    await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(await auditTypes(db, RUN_1031)).toContain("RUN_COMPLETED");
    // Simulate the lost audit: delete the terminal row directly.
    await db.query(
      "DELETE FROM tb_consolidation_audit WHERE run_date = $1 AND entry_type = 'RUN_COMPLETED'",
      [RUN_1031],
    );
    expect(await auditTypes(db, RUN_1031)).not.toContain("RUN_COMPLETED");
    const replay = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(replay.replayed).toBe(true);
    const types = await auditTypes(db, RUN_1031);
    expect(types.filter((t) => t === "RUN_COMPLETED")).toHaveLength(1);
    // A second replay with the audit present duplicates nothing.
    await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(
      (await auditTypes(db, RUN_1031)).filter((t) => t === "RUN_COMPLETED"),
    ).toHaveLength(1);
  });

  it30("a crash inside finalize leaves no partial run row or terminal audit", async () => {
    await repo.captureEpisode(episode({ title: "Atomic finalize" }));
    let crashed = false;
    const crashHandle = {
      query: async (sql, params) => {
        if (!crashed && sql.includes("INSERT INTO tb_consolidation_runs")) {
          crashed = true;
          throw new Error("injected crash in finalize");
        }
        return db.query(sql, params);
      },
    };
    const crashEngine = createConsolidationEngine(crashHandle);
    await expect(crashEngine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    })).rejects.toThrow("injected crash in finalize");
    expect(await countRows(db, "tb_consolidation_runs")).toBe(0);
    expect(await auditTypes(db, RUN_1031)).not.toContain("RUN_COMPLETED");
    // The lease was released by the finally path, so a clean retry
    // completes the same logical run.
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.factsPromoted).toBe(4);
  });

  it30("resuming under different settings is refused", async () => {
    const tightEngine = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 2, consultedByteMax: 5000000, deadlineMs: 120000 },
    });
    for (let i = 0; i < 4; i++) {
      await repo.captureEpisode(episode({ title: `Budgeted ${i}` }));
    }
    const first = await tightEngine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(first.incomplete).toBe(true);
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031 }),
      P6_CODES.RUN_BINDING_MISMATCH,
    );
    await expectTeamBrainError(
      tightEngine.runConsolidation({
        runDate: RUN_1031,
        principal: "consolidator",
        now: NOW_1031,
        limit: 5,
      }),
      P6_CODES.RUN_BINDING_MISMATCH,
    );
    await expectTeamBrainError(
      tightEngine.runConsolidation({ runDate: RUN_1031, principal: "other", now: NOW_1031 }),
      P6_CODES.PRINCIPAL_MISMATCH,
    );
    // The bound resume itself still works.
    const resumed = await tightEngine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(resumed.incomplete).toBe(true);
    expect(resumed.runDate).toBe(RUN_1031);
  });
});

// ---------------------------------------------------------------- 003

describe("Fix round 1 — TBP6-003 missed slots are terminal", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("an already-MISSED date refuses ordinary execution with SLOT_MISSED", async () => {
    // ChatGPT's counterexample: Oct 31 MISSED, then invoked with
    // Nov 1's now, was rewritten COMPLETED. Now it refuses.
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    await engine.runConsolidation({
      runDate: "2026-11-01",
      principal: "consolidator",
      now: "2026-11-01T16:00:00Z",
    });
    const { rows } = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = '2026-10-31'",
    );
    expect(rows[0].state).toBe("MISSED");
    await expectTeamBrainError(
      engine.runConsolidation({
        runDate: "2026-10-31",
        principal: "consolidator",
        now: "2026-11-01T16:00:00Z",
      }),
      P6_CODES.SLOT_MISSED,
    );
    const after = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = '2026-10-31'",
    );
    expect(after.rows[0].state).toBe("MISSED");
  });

  it30("a fresh historical date is refused with SLOT_EXPIRED", async () => {
    // An absent historical date can no longer be executed after its
    // civil day, even when it was never marked MISSED.
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    await expectTeamBrainError(
      engine.runConsolidation({
        runDate: "2026-10-31",
        principal: "consolidator",
        now: "2026-11-01T16:00:00Z",
      }),
      P6_CODES.SLOT_EXPIRED,
    );
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM tb_consolidation_runs WHERE run_date = '2026-10-31'",
    );
    expect(rows[0].n).toBe(0);
  });

  it30("same-day late execution still succeeds", async () => {
    await repo.captureEpisode(episode({ title: "Late same day" }));
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: "2026-10-31T23:30:00Z",
    });
    expect(receipt.counts.factsPromoted).toBe(4);
    // And exactly at the due instant it is due, not early.
    expect(civilDateInChicago("2026-10-31T23:30:00Z")).toBe("2026-10-31");
  });

  it30("a long outage marks the bounded window and records the older baseline", async () => {
    // The >30-day lookback gap: an established installation with its
    // last row 60 days back was wrongly treated as first-ever.
    await db.query(
      `INSERT INTO tb_consolidation_runs
        (run_date, slot_instant, state, lease_generation, source_revision,
         source_watermark, episodes_considered, episodes_promoted,
         duplicates_found, conflicts_found, proposals_filed, receipt,
         started_at, completed_at)
       VALUES ('2026-08-31', $1, 'COMPLETED', 0, 0, '', 0, 0, 0, 0, 0, '{}', $2, $2)`,
      [slotInstantForCivilDate("2026-08-31"), "2026-08-31T16:00:00Z"],
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    // The 30-day window Oct 1..30 is marked MISSED, no further back.
    expect(receipt.counts.missedDates).toHaveLength(30);
    expect(receipt.counts.missedDates[0]).toBe("2026-10-30");
    expect(receipt.counts.missedDates[29]).toBe("2026-10-01");
    expect(receipt.counts.outageBaseline).toBe("2026-08-31");
    expect(await auditTypes(db, RUN_1031)).toContain("RUN_OUTAGE_NOTED");
    const missed = await db.query(
      "SELECT COUNT(*)::int AS n FROM tb_consolidation_runs WHERE state = 'MISSED'",
    );
    expect(missed.rows[0].n).toBe(30);
    // The older baseline row itself is untouched.
    const baseline = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = '2026-08-31'",
    );
    expect(baseline.rows[0].state).toBe("COMPLETED");
  });

  it30("the missed walk crosses the spring-forward transition as civil dates", async () => {
    // Mar 8, 2026 is 23 hours long; Mar 7 and Mar 8 are still two
    // distinct civil dates, and both must be marked MISSED.
    await engine.runConsolidation({
      runDate: "2026-03-06",
      principal: "consolidator",
      now: "2026-03-06T16:00:00Z",
    });
    const receipt = await engine.runConsolidation({
      runDate: "2026-03-09",
      principal: "consolidator",
      now: "2026-03-09T16:00:00Z",
    });
    expect(receipt.counts.missedDates).toEqual(["2026-03-08", "2026-03-07"]);
    expect(receipt.counts.outageBaseline).toBeNull();
  });

  it30("the missed walk crosses the fall-back transition as civil dates", async () => {
    // Nov 1, 2026 is 25 hours long; Oct 31 and Nov 1 are still two
    // distinct civil dates, and both must be marked MISSED.
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    const receipt = await engine.runConsolidation({
      runDate: "2026-11-02",
      principal: "consolidator",
      now: "2026-11-02T16:00:00Z",
    });
    expect(receipt.counts.missedDates).toEqual(["2026-11-01", "2026-10-31"]);
    expect(receipt.counts.outageBaseline).toBeNull();
  });

  it30("a first-ever run marks nothing and records no outage", async () => {
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.missedDates).toEqual([]);
    expect(receipt.counts.outageBaseline).toBeNull();
    expect(await auditTypes(db, RUN_1031)).not.toContain("RUN_OUTAGE_NOTED");
  });
});

// ---------------------------------------------------------------- 004

describe("Fix round 1 — TBP6-004 conflict currency", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a later conflict supersedes the earlier CONFLICT_FREE fact without resolving it", async () => {
    // ChatGPT's counterexample: A promoted alone, B arrives, A's
    // CONFLICT_FREE stayed ACTIVE. Now A is SUPERSEDED, both sides
    // stay unresolved, and both go to Jason.
    const a = await repo.captureEpisode(
      episode({ title: "Group member A", conflictGroup: "g-1" }),
    );
    const run1 = await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    expect(run1.counts.factsPromoted).toBe(4);
    const b = await repo.captureEpisode(
      episode({ title: "Group member B", conflictGroup: "g-1" }),
    );
    const run2 = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(run2.counts.factsSuperseded).toBe(1);
    expect(run2.counts.factsPromoted).toBe(0);
    expect(run2.counts.conflicts).toBe(1);
    const states = await factStates(db);
    expect(states).toEqual({ ACTIVE: 3, SUPERSEDED: 1 });
    // Neither side was resolved: no new facts, and the CONFLICT
    // proposal names both members for Jason.
    const { rows: proposals } = await db.query(
      "SELECT detail FROM tb_consolidation_proposals WHERE proposal_type = 'CONFLICT' AND filed_run_date = $1",
      [RUN_1031],
    );
    expect(proposals).toHaveLength(1);
    const members = JSON.parse(proposals[0].detail).members;
    expect(members).toContain(a.episodeId);
    expect(members).toContain(b.episodeId);
    // History is preserved: run 1's receipt still shows A promoted.
    const receipt1 = await engine.getRunReceipt("2026-10-30", { principal: "consolidator" });
    expect(receipt1.counts.factsPromoted).toBe(4);
    const { rows: facts } = await db.query(
      "SELECT episode_id, fact_type, state FROM tb_consolidated_facts ORDER BY fact_id ASC",
    );
    expect(facts.every((f) => f.episode_id === a.episodeId)).toBe(true);
    // Only the CONFLICT_FREE currency is retired; the episode's
    // other three facts stay ACTIVE as historical record.
    expect(facts.find((f) => f.fact_type === "CONFLICT_FREE").state).toBe("SUPERSEDED");
    expect(facts.filter((f) => f.fact_type !== "CONFLICT_FREE").every((f) => f.state === "ACTIVE")).toBe(true);
  });

  it30("a conflict present before the first run supersedes nothing", async () => {
    await repo.captureEpisode(episode({ title: "Early A", conflictGroup: "g-1" }));
    await repo.captureEpisode(episode({ title: "Early B", conflictGroup: "g-1" }));
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.factsSuperseded).toBe(0);
    expect(receipt.counts.conflicts).toBe(1);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(0);
  });

  it30("an unrelated fact type keeps its ACTIVE state when a conflict lands", async () => {
    const a = await repo.captureEpisode(
      episode({ title: "Conflict A", conflictGroup: "g-1" }),
    );
    await repo.captureEpisode(episode({ title: "Plain fact" }));
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    await repo.captureEpisode(episode({ title: "Conflict B", conflictGroup: "g-1" }));
    await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    const { rows } = await db.query(
      "SELECT fact_type, state, COUNT(*)::int AS n FROM tb_consolidated_facts GROUP BY fact_type, state ORDER BY fact_type, state",
    );
    const byType = {};
    for (const r of rows) (byType[r.fact_type] ??= {})[r.state] = r.n;
    // Only the conflict member's CONFLICT_FREE currency is retired;
    // the plain episode's CONFLICT_FREE stays ACTIVE, as do every
    // episode's other three fact types.
    expect(byType.CONFLICT_FREE).toEqual({ ACTIVE: 1, SUPERSEDED: 1 });
    expect(byType.EPISODE_RECORDED).toEqual({ ACTIVE: 2 });
    expect(byType.SOURCE_VERIFIED).toEqual({ ACTIVE: 2 });
    expect(byType.SCOPE_CLASSIFIED).toEqual({ ACTIVE: 2 });
    expect(a).toBeTruthy();
  });
});

// ---------------------------------------------------------------- 005

describe("Fix round 1 — TBP6-005 typed duplicate identity", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("equal text across scope and source both promote, with a similarity-only proposal", async () => {
    // ChatGPT's counterexample: equal text in design vs queue scopes
    // with different source paths collapsed 2 -> 1. Now both promote.
    await repo.captureEpisode(
      episode({ title: "Same words", body: "Identical body.", scope: "design", source: { ...SRC, path: "design/a.md" } }),
    );
    await repo.captureEpisode(
      episode({ title: "Same words", body: "Identical body.", scope: "queue", source: { ...SRC, path: "queue/b.md" } }),
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.selection.total).toBe(2);
    expect(receipt.counts.factsPromoted).toBe(8);
    expect(receipt.counts.similarities).toBe(1);
    const { rows } = await db.query(
      "SELECT detail FROM tb_consolidation_proposals WHERE proposal_type = 'DUPLICATE'",
    );
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0].detail);
    expect(payload.similarityOnly).toBe(true);
    expect(payload.suppressed).toEqual([]);
    expect(payload.episodes).toHaveLength(2);
  });

  it30("true exact duplicates still collapse to the canonical with occurrences kept", async () => {
    // Distinct episodes (different capturedAt, so capture does not
    // replay them) with one identical typed key collapse to the
    // canonical; the suppressed occurrence is kept in the proposal.
    await repo.captureEpisode(episode({ title: "Twice", body: "Same." }));
    await repo.captureEpisode(
      episode({ title: "Twice", body: "Same.", capturedAt: "2026-10-16T16:00:00Z" }),
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.factsPromoted).toBe(5);
    expect(receipt.counts.duplicates).toBe(1);
    expect(receipt.counts.similarities).toBe(0);
    // The canonical earns its four base facts plus DUPLICATE_CANONICAL.
    const { rows: types } = await db.query(
      "SELECT fact_type FROM tb_consolidated_facts ORDER BY fact_type",
    );
    expect(types.map((r) => r.fact_type)).toEqual([
      "CONFLICT_FREE",
      "DUPLICATE_CANONICAL",
      "EPISODE_RECORDED",
      "SCOPE_CLASSIFIED",
      "SOURCE_VERIFIED",
    ]);
    const { rows } = await db.query(
      "SELECT detail FROM tb_consolidation_proposals WHERE proposal_type = 'DUPLICATE'",
    );
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0].detail);
    expect(payload.similarityOnly).toBeFalsy();
    expect(payload.duplicates).toHaveLength(1);
    expect(typeof payload.canonical).toBe("string");
    expect(payload.duplicates[0]).not.toBe(payload.canonical);
  });

  it30("case-sensitive source identifiers keep facts distinct", async () => {
    await repo.captureEpisode(
      episode({ title: "Case", body: "Same.", source: { ...SRC, commit: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } }),
    );
    await repo.captureEpisode(
      episode({ title: "Case", body: "Same.", source: { ...SRC, commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.factsPromoted).toBe(8);
    expect(receipt.counts.duplicates).toBe(0);
  });

  it30("different visibility and grants keep facts distinct", async () => {
    await repo.captureEpisode(episode({ title: "Split", body: "Same." }));
    await repo.captureEpisode(
      episode({ title: "Split", body: "Same.", visibility: "restricted", grants: ["consolidator"] }),
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(receipt.counts.factsPromoted).toBe(8);
    expect(receipt.counts.duplicates).toBe(0);
    expect(receipt.counts.similarities).toBe(1);
  });
});

// ---------------------------------------------------------------- 006
// Strict grants: the consolidator gets SELECT on P5 tables and
// full rights ONLY on P6 tables — the Section 4 effect set. Every
// test here uses its own fresh database; roles differ per case.

const P5_TABLES = [
  "tb_episodes",
  "tb_episode_grants",
  "tb_episode_events",
  "tb_retrieval_revisions",
  "tb_working_set",
  "tb_pins",
];
const P6_TABLES = [
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_audit",
  "tb_consolidation_run_bindings",
];

describe("Fix round 1 — TBP6-006 real role boundary", () => {
  it30("the consolidator positive applies only Section 4 effects", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      const repo = createRetrievalRepository(db);
      await repo.captureEpisode(episode({ title: "Strict positive" }));
      await db.query("SET ROLE tb_consolidator");
      const engine = createConsolidationEngine(db);
      const receipt = await engine.runConsolidation({
        runDate: RUN_1031,
        principal: "consolidator",
        now: NOW_1031,
      });
      expect(receipt.counts.factsPromoted).toBe(4);
      expect(receipt.role).toBe("tb_consolidator");
      // P5 tables untouched by the run itself.
      expect(await countRows(db, "tb_episodes")).toBe(1);
      expect(await countRows(db, "tb_episode_events")).toBe(0);
      // And the consolidator cannot write P5 tables directly either.
      await expect(
        db.query("INSERT INTO tb_episodes (episode_id) VALUES ('ep-x')"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("UPDATE tb_episodes SET title = 'no'"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("INSERT INTO tb_episode_grants (episode_id, principal) VALUES ('ep-x', 'y')"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });

  it30("a lesser role is denied with zero writes", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      const repo = createRetrievalRepository(db);
      await repo.captureEpisode(episode({ title: "Reader denied" }));
      await db.query("SET ROLE tb_reader");
      const engine = createConsolidationEngine(db);
      await expectTeamBrainError(
        engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031 }),
        P6_CODES.ROLE_DENIED,
      );
      for (const table of P6_TABLES) {
        if (table === "tb_consolidation_lease") {
          const { rows } = await db.query("SELECT holder FROM tb_consolidation_lease WHERE id = 1");
          expect(rows[0].holder).toBeNull();
        } else {
          expect(await countRows(db, table)).toBe(0);
        }
      }
    } finally {
      await db.close();
    }
  });

  it30("the postgres superuser is denied — the TBP6-006 counterexample, closed", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      const repo = createRetrievalRepository(db);
      await repo.captureEpisode(episode({ title: "Superuser denied" }));
      // No SET ROLE: the session is postgres, the superuser. The old
      // code accepted a caller label here and wrote four facts
      // claiming tb_consolidator.
      const engine = createConsolidationEngine(db);
      await expectTeamBrainError(
        engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031 }),
        P6_CODES.ROLE_DENIED,
      );
      expect(await countRows(db, "tb_consolidated_facts")).toBe(0);
      expect(await countRows(db, "tb_consolidation_runs")).toBe(0);
    } finally {
      await db.close();
    }
  });

  it30("PUBLIC privileges do not bypass the identity check", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      const repo = createRetrievalRepository(db);
      await repo.captureEpisode(episode({ title: "Public grant" }));
      await db.query("GRANT INSERT ON tb_consolidated_facts TO PUBLIC");
      await db.query("SET ROLE tb_reader");
      const engine = createConsolidationEngine(db);
      await expectTeamBrainError(
        engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031 }),
        P6_CODES.ROLE_DENIED,
      );
      expect(await countRows(db, "tb_consolidated_facts")).toBe(0);
    } finally {
      await db.close();
    }
  });

  it30("inherited membership does not confer the consolidator identity", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      const repo = createRetrievalRepository(db);
      await repo.captureEpisode(episode({ title: "Inherited" }));
      await db.query("GRANT tb_consolidator TO tb_reader");
      await db.query("SET ROLE tb_reader");
      const engine = createConsolidationEngine(db);
      await expectTeamBrainError(
        engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031 }),
        P6_CODES.ROLE_DENIED,
      );
      expect(await countRows(db, "tb_consolidated_facts")).toBe(0);
    } finally {
      await db.close();
    }
  });

  it30("direct writes as a lesser role are denied by the database itself", async () => {
    const db = new PGlite();
    try {
      await strictDbSetup(db);
      await db.query("SET ROLE tb_reader");
      await expect(
        db.query("INSERT INTO tb_consolidated_facts (fact_id) VALUES ('f-x')"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("UPDATE tb_consolidation_lease SET holder = 'x' WHERE id = 1"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("INSERT INTO tb_episodes (episode_id) VALUES ('ep-x')"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });
});

async function strictDbSetup(db) {
  await migrateP5(db);
  await migrateP6(db);
  await db.query("CREATE ROLE tb_consolidator NOLOGIN");
  await db.query("CREATE ROLE tb_reader NOLOGIN");
  await db.query(`GRANT SELECT ON ${P5_TABLES.join(", ")} TO tb_consolidator`);
  await db.query(
    `GRANT SELECT, INSERT, UPDATE ON ${P6_TABLES.join(", ")} TO tb_consolidator`,
  );
  await db.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tb_consolidator");
  await db.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO tb_reader");
}

// ---------------------------------------------------------------- 007

describe("Fix round 1 — TBP6-007 trusted budgets", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    await prepareBatteryRole(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  const resumeUntilDone = async (runEngine, input, cap = 40) => {
    let outcome = await runEngine.runConsolidation(input);
    let attempts = 1;
    while (outcome.incomplete && attempts < cap) {
      outcome = await runEngine.runConsolidation(input);
      attempts += 1;
    }
    return { outcome, attempts };
  };

  it30("caller-expanded limits are refused and the exact cap fits", async () => {
    // ChatGPT's counterexample: limit 1000000 accepted, receipt
    // reported it. Now anything above the trusted maximum refuses
    // before any write.
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031, limit: 51 }),
      P6_CODES.LIMIT_EXCEEDED,
    );
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, principal: "consolidator", now: NOW_1031, limit: 1000000 }),
      P6_CODES.LIMIT_EXCEEDED,
    );
    expect(await countRows(db, "tb_consolidation_runs")).toBe(0);
    for (let i = 0; i < 60; i++) {
      await repo.captureEpisode(episode({ title: `Sized ${i}` }));
    }
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
      limit: 50,
    });
    expect(receipt.selection.total).toBe(50);
    expect(receipt.selection.limit).toBe(50);
  });

  it30("per-run budget options are ignored: the engine's trusted budgets rule", async () => {
    await repo.captureEpisode(episode({ title: "No escalation" }));
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
      budgets: { version: 99, consultedObjectMax: 1000000 },
    });
    expect(receipt.budgetsVersion).toBe(1);
    expect(receipt.counts.factsPromoted).toBe(4);
  });

  it30("an object budget stops as INCOMPLETE and resumes to correct totals", async () => {
    const tight = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 10, consultedByteMax: 5000000, deadlineMs: 120000 },
    });
    for (let i = 0; i < 8; i++) {
      await repo.captureEpisode(episode({ title: `Object ${i}` }));
    }
    const first = await tight.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(first.incomplete).toBe(true);
    expect(first.reason).toBe("OBJECT_BUDGET");
    const { outcome, attempts } = await resumeUntilDone(tight, {
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.factsPromoted).toBe(32);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(32);
    const { rows } = await db.query(
      "SELECT COUNT(DISTINCT fact_id)::int AS n FROM tb_consolidated_facts",
    );
    expect(rows[0].n).toBe(32);
    expect(attempts).toBeGreaterThan(1);
  });

  it30("a byte budget stops as INCOMPLETE and resumes to correct totals", async () => {
    const tight = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 1000, consultedByteMax: 1000, deadlineMs: 120000 },
    });
    for (let i = 0; i < 8; i++) {
      await repo.captureEpisode(episode({ title: `Byte ${i}` }));
    }
    const first = await tight.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(first.incomplete).toBe(true);
    expect(first.reason).toBe("BYTE_BUDGET");
    const { outcome } = await resumeUntilDone(tight, {
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.factsPromoted).toBe(32);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(32);
  });

  it30("a single oversized row progresses rather than stalling", async () => {
    const tight = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 1000, consultedByteMax: 1000, deadlineMs: 120000 },
    });
    await repo.captureEpisode(episode({ title: "Huge", body: "x".repeat(5000) }));
    const { outcome } = await resumeUntilDone(
      tight,
      { runDate: RUN_1031, principal: "consolidator", now: NOW_1031 },
      6,
    );
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.factsPromoted).toBe(4);
  });

  it30("a deadline stops as INCOMPLETE and a later attempt completes", async () => {
    let t = 0;
    const clock = () => (t += 2000);
    const timed = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 1000, consultedByteMax: 5000000, deadlineMs: 5000 },
      clock,
    });
    await repo.captureEpisode(episode({ title: "Deadline" }));
    const first = await timed.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(first.incomplete).toBe(true);
    expect(first.reason).toBe("DEADLINE");
    // Resume with the normal clock and the SAME trusted budgets
    // (a different budget set would be a binding mismatch).
    const resumeEngine = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 1000, consultedByteMax: 5000000, deadlineMs: 5000 },
    });
    const { outcome } = await resumeUntilDone(resumeEngine, {
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.factsPromoted).toBe(4);
  });

  it30("a conflict group larger than the object budget is processed whole", async () => {
    const tight = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 3, consultedByteMax: 5000000, deadlineMs: 120000 },
    });
    for (let i = 0; i < 5; i++) {
      await repo.captureEpisode(episode({ title: `Big group ${i}`, conflictGroup: "g-big" }));
    }
    const { outcome } = await resumeUntilDone(tight, {
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.conflicts).toBe(1);
    expect(outcome.counts.factsPromoted).toBe(0);
  });

  it30("a large reverify set stops as INCOMPLETE and resumes to archived facts", async () => {
    await repo.captureEpisode(episode({ title: "To archive" }));
    await engine.runConsolidation({
      runDate: "2026-10-30",
      principal: "consolidator",
      now: "2026-10-30T16:00:00Z",
    });
    const { rows: eps } = await db.query("SELECT episode_id FROM tb_episodes LIMIT 1");
    await repo.archiveEpisode(eps[0].episode_id, { note: "Retired.", actor: "test" });
    const tight = createConsolidationEngine(db, {
      budgets: { version: 1, selectionLimitMax: 50, consultedObjectMax: 2, consultedByteMax: 5000000, deadlineMs: 120000 },
    });
    const first = await tight.runConsolidation({
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(first.incomplete).toBe(true);
    const { outcome } = await resumeUntilDone(tight, {
      runDate: RUN_1031,
      principal: "consolidator",
      now: NOW_1031,
    });
    expect(outcome.incomplete).toBeFalsy();
    expect(outcome.counts.factsArchived).toBe(4);
    expect(await factStates(db)).toEqual({ ARCHIVED: 4 });
  });
});
