// Team Brain P6 — consolidation / replay engine.
// Offline: one in-memory PGlite per file (real PostgreSQL semantics,
// no network, no live database, no credentials). Every timestamp is a
// fixed literal; the engine takes `now` as an input, never reads the
// wall clock inside a run, so runs are deterministic in tests.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CHECKPOINTS,
  CONSOLIDATOR_ROLE,
  FACT_TYPES,
  createConsolidationEngine,
  loadP6SchemaSql,
  migrateP6,
} from "../consolidation/engine.mjs";
import { P6_CODES } from "../consolidation/errors.mjs";
import {
  civilDateInChicago,
  isSlotDue,
  slotInstantForCivilDate,
} from "../consolidation/scheduling.mjs";
import {
  createRetrievalRepository,
  migrate as migrateP5,
} from "../retrieval/repository.mjs";

const it30 = (name, fn) => it(name, fn, 30000);
const SLOT_1031 = "2026-10-31T08:00:00.000Z";
const NOW_1031 = "2026-10-31T12:00:00Z";
const RUN_1031 = "2026-10-31";

const SRC = {
  repo: "onyxgolden/marketplace409",
  path: "scripts/team-brain/consolidation/engine.mjs",
  commit: "f579db64bc36f8359e8e6ea7ef14456d6006c9fd",
  blob: "fixture-blob-p6",
  watermark: "main@f579db6",
};

function episode(overrides = {}) {
  return {
    scope: "queue",
    title: "Queue ordering",
    body: "The executive queue orders open asks by filed-at time, oldest unanswered first.",
    source: { ...SRC },
    capturedAt: "2026-10-15T16:00:00Z",
    ...overrides,
  };
}

async function truncateAll(db) {
  await db.query(
    `TRUNCATE tb_consolidated_facts, tb_consolidation_proposals,
      tb_consolidation_checkpoints, tb_consolidation_audit,
      tb_consolidation_runs, tb_working_set, tb_episode_grants,
      tb_pins, tb_episode_events, tb_episodes CASCADE`,
  );
  await db.query("UPDATE tb_retrieval_revisions SET revision = 0 WHERE id = 1");
  await db.query(
    "UPDATE tb_consolidation_lease SET holder = NULL, run_date = NULL, acquired_at = NULL, generation = 0 WHERE id = 1",
  );
}

async function countRows(db, table) {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

function expectTeamBrainError(promise, code) {
  return expect(promise).rejects.toMatchObject({ name: "TeamBrainError", code });
}

describe("P6 schema", () => {
  let db;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("schema applies and re-applies idempotently", async () => {
    await migrateP6(db);
    await migrateP6(db);
    const { rows } = await db.query(
      "SELECT COUNT(*) AS n FROM tb_consolidation_lease WHERE id = 1",
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it30("all six P6 tables exist", async () => {
    for (const table of [
      "tb_consolidation_runs",
      "tb_consolidation_lease",
      "tb_consolidated_facts",
      "tb_consolidation_proposals",
      "tb_consolidation_checkpoints",
      "tb_consolidation_audit",
    ]) {
      const { rows } = await db.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = $1",
        [table],
      );
      expect(rows.length).toBe(1);
    }
  });

  it30("lease row starts free at generation 0", async () => {
    const { rows } = await db.query(
      "SELECT holder, generation FROM tb_consolidation_lease WHERE id = 1",
    );
    expect(rows[0].holder).toBeNull();
    expect(Number(rows[0].generation)).toBe(0);
  });
});

describe("P6 scheduling (pure)", () => {
  it30("normal day: 03:00 CDT is 08:00Z", () => {
    expect(slotInstantForCivilDate("2026-10-31")).toBe("2026-10-31T08:00:00.000Z");
  });

  it30("spring-forward day: 03:00 CDT still exists at 08:00Z", () => {
    expect(slotInstantForCivilDate("2026-03-08")).toBe("2026-03-08T08:00:00.000Z");
  });

  it30("fall-back day: 03:00 CST is 09:00Z", () => {
    expect(slotInstantForCivilDate("2026-11-01")).toBe("2026-11-01T09:00:00.000Z");
  });

  it30("consecutive slots are 23h across spring forward", () => {
    const a = Date.parse(slotInstantForCivilDate("2026-03-07"));
    const b = Date.parse(slotInstantForCivilDate("2026-03-08"));
    expect(b - a).toBe(23 * 3600 * 1000);
  });

  it30("consecutive slots are 25h across fall back", () => {
    const a = Date.parse(slotInstantForCivilDate("2026-10-31"));
    const b = Date.parse(slotInstantForCivilDate("2026-11-01"));
    expect(b - a).toBe(25 * 3600 * 1000);
  });

  it30("slot due at exactly the slot instant", () => {
    expect(isSlotDue("2026-10-31", SLOT_1031)).toBe(true);
  });

  it30("slot not due one second before", () => {
    expect(isSlotDue("2026-10-31", "2026-10-31T07:59:59Z")).toBe(false);
  });

  it30("slot due after the instant", () => {
    expect(isSlotDue("2026-10-31", NOW_1031)).toBe(true);
  });

  it30("civil date in Chicago: 04:00Z Oct 31 is Oct 30 local", () => {
    expect(civilDateInChicago("2026-10-31T04:00:00Z")).toBe("2026-10-30");
  });

  it30("civil date in Chicago: 12:00Z Oct 31 is Oct 31 local", () => {
    expect(civilDateInChicago("2026-10-31T12:00:00Z")).toBe("2026-10-31");
  });

  it30("invalid run dates are refused", async () => {
    for (const bad of ["2026-13-01", "2026-02-30", "10/31/2026", "", 20261031, null]) {
      expect(() => slotInstantForCivilDate(bad)).toThrow();
    }
  });
});

describe("P6 run gates", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("lesser roles are denied with zero persisted effects", async () => {
    for (const role of ["tb_reader", "tb_writer", "public"]) {
      await expectTeamBrainError(
        engine.runConsolidation({ runDate: RUN_1031, role, now: NOW_1031 }),
        P6_CODES.ROLE_DENIED,
      );
    }
    // An empty role is an input error, not a role denial — still zero writes.
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, role: "", now: NOW_1031 }),
      "INVALID_FIELD",
    );
    for (const table of [
      "tb_consolidation_runs",
      "tb_consolidated_facts",
      "tb_consolidation_proposals",
      "tb_consolidation_checkpoints",
      "tb_consolidation_audit",
    ]) {
      expect(await countRows(db, table)).toBe(0);
    }
    const { rows } = await db.query(
      "SELECT holder FROM tb_consolidation_lease WHERE id = 1",
    );
    expect(rows[0].holder).toBeNull();
  });

  it30("a run before its slot is refused with zero writes", async () => {
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, now: "2026-10-31T07:00:00Z" }),
      P6_CODES.SLOT_NOT_DUE,
    );
    expect(await countRows(db, "tb_consolidation_runs")).toBe(0);
  });

  it30("a non-positive limit is refused", async () => {
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, limit: 0, now: NOW_1031 }),
      "INVALID_FIELD",
    );
  });

  it30("a run for a malformed date is refused", async () => {
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: "31-10-2026", now: NOW_1031 }),
      P6_CODES.INVALID_RUN_DATE,
    );
  });

  it30("migrateP6 without the P5 schema fails with a named prerequisite", async () => {
    const db2 = new PGlite();
    try {
      await expectTeamBrainError(migrateP6(db2), P6_CODES.MISSING_PREREQUISITE);
    } finally {
      await db2.close();
    }
  });

  it30("lease is released when a run fails mid-way", async () => {
    // A handle whose third query throws simulates a mid-run
    // database failure after the lease is acquired. The finally
    // block must still free the lease.
    let calls = 0;
    const flaky = {
      query: async (...args) => {
        calls += 1;
        if (calls === 3) throw new Error("simulated mid-run failure");
        return db.query(...args);
      },
      exec: (...args) => db.exec(...args),
    };
    const engineFlaky = createConsolidationEngine(flaky);
    await expect(engineFlaky.runConsolidation({ runDate: RUN_1031, now: NOW_1031 })).rejects.toThrow(
      "simulated mid-run failure",
    );
    const { rows } = await db.query("SELECT holder FROM tb_consolidation_lease WHERE id = 1");
    expect(rows[0].holder).toBeNull();
  });
});

describe("P6 happy-path run", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  async function seedMixed() {
    const clean = await repo.captureEpisode(episode({ title: "Clean recent" }));
    const older = await repo.captureEpisode(
      episode({ title: "Clean older", body: "An older uncontested fact.", capturedAt: "2026-08-01T16:00:00Z" }),
    );
    const c1 = await repo.captureEpisode(
      episode({ title: "Claim A", body: "The queue is oldest-first.", conflictGroup: "g1" }),
    );
    const c2 = await repo.captureEpisode(
      episode({ title: "Claim B", body: "The queue is newest-first.", conflictGroup: "g1" }),
    );
    const d1 = await repo.captureEpisode(
      episode({ title: "Same words", body: "Identical body text here.", capturedAt: "2026-10-10T16:00:00Z" }),
    );
    const d2 = await repo.captureEpisode(
      episode({ title: "Same words", body: "Identical body text here.", capturedAt: "2026-10-20T16:00:00Z" }),
    );
    const unavail = await repo.captureEpisode(
      episode({
        title: "No provenance",
        body: "Attribution missing.",
        source: { repo: SRC.repo, path: SRC.path, watermark: SRC.watermark },
        provenanceStatus: "UNAVAILABLE",
      }),
    );
    const granted = await repo.captureEpisode(
      episode({
        title: "Restricted granted",
        body: "Visible to the consolidator.",
        visibility: "restricted",
        grants: ["consolidator"],
      }),
    );
    const denied = await repo.captureEpisode(
      episode({
        title: "Restricted denied",
        body: "Not visible to the consolidator.",
        visibility: "restricted",
        grants: ["someone-else"],
      }),
    );
    // Forbidden scope, inserted directly (capture would refuse it).
    const { rows: rev } = await db.query("SELECT revision FROM tb_retrieval_revisions WHERE id = 1");
    await db.query(
      `INSERT INTO tb_episodes (episode_id, scope, title, body, source_repo, source_path,
        source_commit, source_blob, source_watermark, captured_at, captured_at_ms,
        revision, state, visibility, provenance_status, conflict_group)
       VALUES ('ep-forbidden', 'ledger', 'Ledger row', 'A ledger entry.', $1, $2, $3, $4, $5, '2026-10-15T16:00:00Z', 1760544000000, $6, 'ACTIVE', 'public', 'COMPLETE', NULL)`,
      [SRC.repo, SRC.path, SRC.commit, SRC.blob, SRC.watermark, Number(rev[0].revision)],
    );
    return { clean, older, c1, c2, d1, d2, unavail, granted, denied };
  }

  it30("mixed run: counts, facts, proposals, checkpoints, receipt", async () => {
    const ids = await seedMixed();
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.replayed).toBe(false);
    expect(receipt.slotInstant).toBe(SLOT_1031);
    // Selected: clean, older, c1, c2, d1, d2, unavail, granted = 8.
    // Denied restricted + forbidden are invisible to counts.
    expect(receipt.counts.considered).toBe(8);
    // Promoted: clean, older, d2 (canonical: first in selection
    // order, which is newest-first), granted = 4.
    expect(receipt.counts.promoted).toBe(4);
    expect(receipt.counts.skipped).toBe(4);
    expect(receipt.counts.duplicates).toBe(1);
    expect(receipt.counts.conflicts).toBe(1);
    expect(receipt.counts.proposalsFiled).toBe(2);
    expect(receipt.counts.factsPromoted).toBe(4 * 4 + 1); // 4 types each + DUPLICATE_CANONICAL for d2
    expect(receipt.checkpoints).toEqual(CHECKPOINTS);
    expect(receipt.verification.promoted).toContain(ids.clean.episodeId);
    expect(receipt.verification.promoted).toContain(ids.granted.episodeId);
    expect(receipt.verification.promoted).not.toContain(ids.c1.episodeId);
    expect(receipt.verification.promoted).not.toContain(ids.d1.episodeId);
    // Fact rows exist with the closed types.
    const { rows: facts } = await db.query(
      "SELECT fact_type FROM tb_consolidated_facts WHERE episode_id = $1 ORDER BY fact_type",
      [ids.clean.episodeId],
    );
    expect(facts.map((r) => r.fact_type)).toEqual([
      "CONFLICT_FREE",
      "EPISODE_RECORDED",
      "SCOPE_CLASSIFIED",
      "SOURCE_VERIFIED",
    ]);
    const { rows: dupFacts } = await db.query(
      "SELECT fact_type FROM tb_consolidated_facts WHERE episode_id = $1 AND fact_type = 'DUPLICATE_CANONICAL'",
      [ids.d2.episodeId],
    );
    expect(dupFacts.length).toBe(1);
    // Proposals are OPEN, one conflict + one duplicate.
    const { rows: props } = await db.query(
      "SELECT proposal_type, status FROM tb_consolidation_proposals ORDER BY proposal_type",
    );
    expect(props).toEqual([
      { proposal_type: "CONFLICT", status: "OPEN" },
      { proposal_type: "DUPLICATE", status: "OPEN" },
    ]);
    // All six checkpoints recorded.
    const { rows: cps } = await db.query(
      "SELECT checkpoint FROM tb_consolidation_checkpoints WHERE run_date = $1 ORDER BY checkpoint",
      [RUN_1031],
    );
    expect(cps.map((r) => r.checkpoint).sort()).toEqual([...CHECKPOINTS].sort());
    // Lease released.
    const { rows: lease } = await db.query("SELECT holder FROM tb_consolidation_lease WHERE id = 1");
    expect(lease[0].holder).toBeNull();
  });

  it30("a completed run replays its stored receipt without re-applying", async () => {
    await seedMixed();
    const first = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const factsBefore = await countRows(db, "tb_consolidated_facts");
    const second = await engine.runConsolidation({ runDate: RUN_1031, now: "2026-10-31T18:00:00Z" });
    expect(second.replayed).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(factsBefore);
    expect(await countRows(db, "tb_consolidation_proposals")).toBe(2);
  });

  it30("getRunReceipt returns the stored receipt; unknown run refused", async () => {
    await seedMixed();
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const readback = await engine.getRunReceipt(RUN_1031);
    expect(readback.receiptId).toBe(receipt.receiptId);
    await expectTeamBrainError(engine.getRunReceipt("2026-10-30"), P6_CODES.UNKNOWN_RUN);
  });

  it30("audit export is ordered and covers every step", async () => {
    await seedMixed();
    await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const exported = await engine.exportAudit(RUN_1031);
    expect(exported.state).toBe("COMPLETED");
    const types = exported.entries.map((e) => e.entryType);
    for (const step of ["RUN_STARTED", "SNAPSHOT", "SELECTION", "VERIFICATION", "PROPOSALS", "APPLY", "EXPORT", "RUN_COMPLETED"]) {
      expect(types).toContain(step);
    }
    const seqs = exported.entries.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    await expectTeamBrainError(engine.exportAudit("2026-10-30"), P6_CODES.UNKNOWN_RUN);
  });

  it30("same seed in two fresh databases yields the same receipt id", async () => {
    const runOnce = async () => {
      const db2 = new PGlite();
      try {
        await migrateP5(db2);
        await migrateP6(db2);
        const repo2 = createRetrievalRepository(db2);
        const engine2 = createConsolidationEngine(db2);
        await repo2.captureEpisode(episode({ title: "Alpha" }));
        await repo2.captureEpisode(episode({ title: "Beta", body: "A second fact." }));
        const receipt = await engine2.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
        return receipt.receiptId;
      } finally {
        await db2.close();
      }
    };
    expect(await runOnce()).toBe(await runOnce());
  });
});

describe("P6 selection", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  async function seedRecentOlder(recentCount, olderCount) {
    for (let i = 0; i < recentCount; i += 1) {
      await repo.captureEpisode(
        episode({ title: `Recent ${i}`, body: `Recent fact ${i}.`, capturedAt: `2026-10-${String(10 + i).padStart(2, "0")}T16:00:00Z` }),
      );
    }
    for (let i = 0; i < olderCount; i += 1) {
      await repo.captureEpisode(
        episode({ title: `Older ${i}`, body: `Older fact ${i}.`, capturedAt: `2026-08-${String(10 + i).padStart(2, "0")}T16:00:00Z` }),
      );
    }
  }

  it30("70/30 mix: limit 10 over 10 recent + 10 older yields 7 + 3", async () => {
    await seedRecentOlder(10, 10);
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, limit: 10, now: NOW_1031 });
    expect(receipt.selection.recent).toBe(7);
    expect(receipt.selection.older).toBe(3);
    expect(receipt.selection.total).toBe(10);
  });

  it30("a short side is filled from the other side", async () => {
    await seedRecentOlder(3, 0);
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, limit: 10, now: NOW_1031 });
    expect(receipt.selection.total).toBe(3);
    expect(receipt.selection.recent).toBe(3);
  });

  it30("the limit is never exceeded", async () => {
    await seedRecentOlder(20, 20);
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, limit: 50, now: NOW_1031 });
    expect(receipt.selection.total).toBe(40);
    const small = await engine.runConsolidation({ runDate: "2026-11-01", limit: 5, now: "2026-11-01T12:00:00Z" });
    expect(small.selection.total).toBe(5);
  });

  it30("selection is deterministic and newest-first within each side", async () => {
    await seedRecentOlder(5, 5);
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, limit: 10, now: NOW_1031 });
    const ids = receipt.selection.episodeIds;
    expect(ids.length).toBe(10);
    expect(new Set(ids).size).toBe(10);
    // The newest recent episode sorts first overall.
    const { rows } = await db.query(
      "SELECT episode_id FROM tb_episodes WHERE title = 'Recent 4'",
    );
    expect(ids[0]).toBe(rows[0].episode_id);
  });

  it30("empty store selects nothing and still completes", async () => {
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.selection.total).toBe(0);
    expect(receipt.counts.promoted).toBe(0);
    expect(receipt.snapshot.episodeCount).toBe(0);
  });

  it30("archived episodes are excluded from selection", async () => {
    const live = await repo.captureEpisode(episode({ title: "Live" }));
    const gone = await repo.captureEpisode(episode({ title: "Gone", body: "Archived fact." }));
    await repo.archiveEpisode(gone.episodeId, { note: "Retired.", actor: "test" });
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.selection.episodeIds).toEqual([live.episodeId]);
  });
});

describe("P6 verification details", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a multi-member conflict group blocks every member", async () => {
    await repo.captureEpisode(episode({ title: "A", body: "First claim.", conflictGroup: "gx" }));
    await repo.captureEpisode(episode({ title: "B", body: "Second claim.", conflictGroup: "gx" }));
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.counts.promoted).toBe(0);
    expect(receipt.counts.conflicts).toBe(1);
    expect(receipt.verification.conflicts[0].members.length).toBe(2);
  });

  it30("a sole authorized member of a group promotes", async () => {
    const visible = await repo.captureEpisode(
      episode({ title: "Visible", body: "Only visible member.", conflictGroup: "gx" }),
    );
    await repo.captureEpisode(
      episode({
        title: "Hidden",
        body: "Denied member.",
        conflictGroup: "gx",
        visibility: "restricted",
        grants: ["someone-else"],
      }),
    );
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.verification.promoted).toEqual([visible.episodeId]);
    expect(receipt.counts.conflicts).toBe(0);
  });

  it30("a duplicate triple promotes only the canonical", async () => {
    await repo.captureEpisode(
      episode({ title: "Dup", body: "Same text.", capturedAt: "2026-10-10T16:00:00Z" }),
    );
    await repo.captureEpisode(episode({ title: "Dup", body: "Same text.", capturedAt: "2026-10-11T16:00:00Z" }));
    // Canonical is first in selection order (newest-first): the
    // 10-12 episode, whose messy title/body still normalize to the
    // same duplicate key.
    const canonical = await repo.captureEpisode(
      episode({ title: "  dup  ", body: "  Same   text. ", capturedAt: "2026-10-12T16:00:00Z" }),
    );
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.verification.promoted).toEqual([canonical.episodeId]);
    expect(receipt.counts.duplicates).toBe(1);
    expect(receipt.verification.duplicates[0].duplicates.length).toBe(2);
  });

  it30("unavailable provenance is skipped, never promoted", async () => {
    await repo.captureEpisode(
      episode({
        title: "Missing",
        body: "No source.",
        source: { repo: SRC.repo, path: SRC.path, watermark: SRC.watermark },
        provenanceStatus: "UNAVAILABLE",
      }),
    );
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.counts.promoted).toBe(0);
    expect(receipt.verification.skipped[0].reason).toBe("UNAVAILABLE_PROVENANCE");
  });

  it30("snapshot fingerprint excludes denied episodes", async () => {
    await repo.captureEpisode(episode({ title: "Public" }));
    await repo.captureEpisode(
      episode({
        title: "Denied",
        body: "Not for this principal.",
        visibility: "restricted",
        grants: ["someone-else"],
      }),
    );
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.snapshot.episodeCount).toBe(1);
    const other = await engine.runConsolidation({
      runDate: "2026-11-01",
      principal: "someone-else",
      now: "2026-11-01T12:00:00Z",
    });
    expect(other.snapshot.episodeCount).toBe(2);
    expect(other.snapshot.watermark).not.toBe(receipt.snapshot.watermark);
  });

  it30("forbidden scopes never reach selection even on direct insert", async () => {
    await repo.captureEpisode(episode({ title: "Clean" }));
    const { rows: rev } = await db.query("SELECT revision FROM tb_retrieval_revisions WHERE id = 1");
    for (const scope of ["tenant", "ledger", "financial", "enrollment", "scheduling"]) {
      await db.query(
        `INSERT INTO tb_episodes (episode_id, scope, title, body, source_repo, source_path,
          source_commit, source_blob, source_watermark, captured_at, captured_at_ms,
          revision, state, visibility, provenance_status, conflict_group)
         VALUES ($1, $2, 'Forbidden', 'Must not consolidate.', $3, $4, $5, $6, $7, '2026-10-15T16:00:00Z', 1760544000000, $8, 'ACTIVE', 'public', 'COMPLETE', NULL)`,
        [`ep-forbidden-${scope}`, scope, SRC.repo, SRC.path, SRC.commit, SRC.blob, SRC.watermark, Number(rev[0].revision)],
      );
    }
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.counts.considered).toBe(1);
    expect(receipt.snapshot.episodeCount).toBe(1);
  });
});

describe("P6 explicit proposals (guarded types)", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a standing-rule proposal without authorization is refused", async () => {
    await expectTeamBrainError(
      engine.fileExplicitProposal(
        { type: "STANDING_RULE", detail: { rule: "Change the queue order." } },
        { runDate: RUN_1031, now: NOW_1031 },
      ),
      P6_CODES.AUTHORIZATION_REQUIRED,
    );
    expect(await countRows(db, "tb_consolidation_proposals")).toBe(0);
  });

  it30("a standing-rule proposal with authorization stores OPEN and replays", async () => {
    const proposal = {
      type: "STANDING_RULE",
      detail: { rule: "Change the queue order." },
      authorization: { id: "jason-2026-10-31", note: "Jason's word in chat." },
    };
    const first = await engine.fileExplicitProposal(proposal, { runDate: RUN_1031, now: NOW_1031 });
    const second = await engine.fileExplicitProposal(proposal, { runDate: RUN_1031, now: NOW_1031 });
    expect(first.proposalId).toBe(second.proposalId);
    expect(first.status).toBe("OPEN");
    expect(await countRows(db, "tb_consolidation_proposals")).toBe(1);
    const { rows } = await db.query("SELECT authorization_id FROM tb_consolidation_proposals");
    expect(rows[0].authorization_id).toBe("jason-2026-10-31");
  });

  it30("a permission-change proposal requires the same authorization", async () => {
    await expectTeamBrainError(
      engine.fileExplicitProposal(
        { type: "PERMISSION_CHANGE", detail: { grant: "tb_reader to tb_writer" } },
        { runDate: RUN_1031, now: NOW_1031 },
      ),
      P6_CODES.AUTHORIZATION_REQUIRED,
    );
    const filed = await engine.fileExplicitProposal(
      {
        type: "PERMISSION_CHANGE",
        detail: { grant: "tb_reader to tb_writer" },
        authorization: { id: "jason-2026-10-31", note: "Jason's word." },
      },
      { runDate: RUN_1031, now: NOW_1031 },
    );
    expect(filed.status).toBe("OPEN");
  });

  it30("replay-only types cannot be filed by hand", async () => {
    for (const type of ["CONFLICT", "DUPLICATE"]) {
      await expectTeamBrainError(
        engine.fileExplicitProposal(
          { type, detail: {}, authorization: { id: "x", note: "y" } },
          { runDate: RUN_1031, now: NOW_1031 },
        ),
        P6_CODES.INVALID_PROPOSAL,
      );
    }
  });

  it30("unknown proposal types and fields are refused", async () => {
    await expectTeamBrainError(
      engine.fileExplicitProposal(
        { type: "DELETE_EVERYTHING", detail: {} },
        { runDate: RUN_1031, now: NOW_1031 },
      ),
      P6_CODES.INVALID_PROPOSAL,
    );
    await expectTeamBrainError(
      engine.fileExplicitProposal(
        { type: "STANDING_RULE", detail: {}, authorization: { id: "x", note: "y" }, surprise: true },
        { runDate: RUN_1031, now: NOW_1031 },
      ),
      P6_CODES.INVALID_PROPOSAL,
    );
  });

  it30("replay text never files a guarded proposal on its own", async () => {
    await repo.captureEpisode(
      episode({
        title: "Change the standing rule",
        body: "We should change the standing rule and grant tb_writer to everyone.",
      }),
    );
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.counts.proposalsFiled).toBe(0);
    const { rows } = await db.query(
      "SELECT proposal_type FROM tb_consolidation_proposals WHERE proposal_type IN ('STANDING_RULE', 'PERMISSION_CHANGE')",
    );
    expect(rows.length).toBe(0);
  });
});

describe("P6 apply + archive-without-delete", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("reverify archives facts of a newly archived episode, never deletes", async () => {
    const ep = await repo.captureEpisode(episode({ title: "Soon archived" }));
    await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const before = await countRows(db, "tb_consolidated_facts");
    expect(before).toBeGreaterThan(0);
    await repo.archiveEpisode(ep.episodeId, { note: "Retired.", actor: "test" });
    const receipt = await engine.runConsolidation({ runDate: "2026-11-01", now: "2026-11-01T12:00:00Z" });
    expect(receipt.counts.factsArchived).toBe(before);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(before);
    const { rows } = await db.query(
      "SELECT state, archived_note FROM tb_consolidated_facts WHERE episode_id = $1",
      [ep.episodeId],
    );
    expect(rows.every((r) => r.state === "ARCHIVED")).toBe(true);
    expect(rows[0].archived_note).toMatch(/archived/);
  });

  it30("fact ids are deterministic per episode and type", async () => {
    const ep = await repo.captureEpisode(episode({ title: "Stable" }));
    await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const { rows } = await db.query(
      "SELECT fact_id FROM tb_consolidated_facts WHERE episode_id = $1 AND fact_type = 'EPISODE_RECORDED'",
      [ep.episodeId],
    );
    expect(rows.length).toBe(1);
    // A second run's re-apply finds the same id (no duplicate row).
    await engine.runConsolidation({ runDate: "2026-11-01", now: "2026-11-01T12:00:00Z" });
    const { rows: again } = await db.query(
      "SELECT fact_id FROM tb_consolidated_facts WHERE episode_id = $1 AND fact_type = 'EPISODE_RECORDED'",
      [ep.episodeId],
    );
    expect(again.length).toBe(1);
    expect(again[0].fact_id).toBe(rows[0].fact_id);
  });

  it30("fact types stay inside the closed schema", async () => {
    await repo.captureEpisode(episode({ title: "Typed" }));
    await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    const { rows } = await db.query("SELECT DISTINCT fact_type FROM tb_consolidated_facts");
    for (const row of rows) {
      expect(FACT_TYPES).toContain(row.fact_type);
    }
  });
});

describe("P6 lease, restart, two workers", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a lease held by another worker refuses with zero writes", async () => {
    await repo.captureEpisode(episode({ title: "Blocked" }));
    await db.query(
      "UPDATE tb_consolidation_lease SET holder = 'other-worker', run_date = $1, acquired_at = $2 WHERE id = 1",
      [RUN_1031, NOW_1031],
    );
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 }),
      P6_CODES.LEASE_HELD,
    );
    expect(await countRows(db, "tb_consolidation_runs")).toBe(0);
    expect(await countRows(db, "tb_consolidated_facts")).toBe(0);
  });

  it30("two concurrent runs: one completes, one is lease-held", async () => {
    await repo.captureEpisode(episode({ title: "Contended" }));
    const [a, b] = await Promise.allSettled([
      engine.runConsolidation({ runDate: RUN_1031, holder: "worker-a", now: NOW_1031 }),
      engine.runConsolidation({ runDate: RUN_1031, holder: "worker-b", now: NOW_1031 }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.code).toBe(P6_CODES.LEASE_HELD);
    expect(fulfilled[0].value.counts.promoted).toBe(1);
  });

  it30("a crashed lease refuses without recover, resumes with the same holder", async () => {
    await repo.captureEpisode(episode({ title: "Crashed" }));
    await db.query(
      "UPDATE tb_consolidation_lease SET holder = 'crashed-worker', run_date = $1, acquired_at = $2 WHERE id = 1",
      [RUN_1031, NOW_1031],
    );
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, holder: "crashed-worker", now: NOW_1031 }),
      P6_CODES.LEASE_HELD,
    );
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: RUN_1031, holder: "someone-else", recover: true, now: NOW_1031 }),
      P6_CODES.LEASE_HELD,
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      holder: "crashed-worker",
      recover: true,
      now: NOW_1031,
    });
    expect(receipt.counts.promoted).toBe(1);
    const { rows } = await db.query("SELECT holder FROM tb_consolidation_lease WHERE id = 1");
    expect(rows[0].holder).toBeNull();
  });

  it30("resume after a mid-run crash writes nothing twice", async () => {
    const ep = await repo.captureEpisode(episode({ title: "Partial" }));
    // Simulate a crash after SNAPSHOT + a partial APPLY: lease held,
    // one checkpoint row, one fact row already written.
    await db.query(
      "UPDATE tb_consolidation_lease SET holder = 'crashed-worker', run_date = $1, acquired_at = $2 WHERE id = 1",
      [RUN_1031, NOW_1031],
    );
    await db.query(
      "INSERT INTO tb_consolidation_checkpoints (run_date, checkpoint, counts, recorded_at) VALUES ($1, 'SNAPSHOT', '{}', $2)",
      [RUN_1031, NOW_1031],
    );
    await db.query(
      `INSERT INTO tb_consolidated_facts (fact_id, episode_id, fact_type, fact_key, fact_value, promoted_revision, promoted_run_date, state)
       VALUES ('fact-crash-seed', $1, 'EPISODE_RECORDED', $1, '{}', 1, $2, 'ACTIVE')`,
      [ep.episodeId, RUN_1031],
    );
    const receipt = await engine.runConsolidation({
      runDate: RUN_1031,
      holder: "crashed-worker",
      recover: true,
      now: NOW_1031,
    });
    expect(receipt.counts.promoted).toBe(1);
    // The seeded fact row is untouched; the engine's own fact id for
    // the same episode+type is a second, distinct row (the seed was
    // not engine-shaped) — but no row is duplicated by the resume.
    const { rows } = await db.query(
      "SELECT fact_id, COUNT(*) AS n FROM tb_consolidated_facts GROUP BY fact_id HAVING COUNT(*) > 1",
    );
    expect(rows.length).toBe(0);
    const { rows: cps } = await db.query(
      "SELECT checkpoint FROM tb_consolidation_checkpoints WHERE run_date = $1",
      [RUN_1031],
    );
    expect(cps.map((r) => r.checkpoint).sort()).toEqual([...CHECKPOINTS].sort());
  });
});

describe("P6 missed slots + DST runs", () => {
  let db;
  let repo;
  let engine;

  beforeAll(async () => {
    db = new PGlite();
    await migrateP5(db);
    await migrateP6(db);
    repo = createRetrievalRepository(db);
    engine = createConsolidationEngine(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("a skipped date is recorded MISSED, never backfilled", async () => {
    await repo.captureEpisode(episode({ title: "Steady" }));
    await engine.runConsolidation({ runDate: "2026-10-30", now: "2026-10-30T12:00:00Z" });
    const receipt = await engine.runConsolidation({ runDate: "2026-11-01", now: "2026-11-01T12:00:00Z" });
    expect(receipt.counts.missedDates).toEqual(["2026-10-31"]);
    const { rows } = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = '2026-10-31'",
    );
    expect(rows[0].state).toBe("MISSED");
    // The missed date has no receipt and no facts of its own.
    await expectTeamBrainError(engine.getRunReceipt("2026-10-31"), P6_CODES.UNKNOWN_RUN);
  });

  it30("a first-ever run marks no missed dates", async () => {
    await repo.captureEpisode(episode({ title: "First" }));
    const receipt = await engine.runConsolidation({ runDate: RUN_1031, now: NOW_1031 });
    expect(receipt.counts.missedDates).toEqual([]);
    expect(await countRows(db, "tb_consolidation_runs")).toBe(1);
  });

  it30("spring-forward slot runs at 08:00Z", async () => {
    await repo.captureEpisode(episode({ title: "DST spring", capturedAt: "2026-03-01T16:00:00Z" }));
    const receipt = await engine.runConsolidation({ runDate: "2026-03-08", now: "2026-03-08T09:00:00Z" });
    expect(receipt.slotInstant).toBe("2026-03-08T08:00:00.000Z");
    expect(receipt.counts.promoted).toBe(1);
  });

  it30("fall-back slot is not due before 09:00Z and due at 09:00Z", async () => {
    await repo.captureEpisode(episode({ title: "DST fall", capturedAt: "2026-10-15T16:00:00Z" }));
    await expectTeamBrainError(
      engine.runConsolidation({ runDate: "2026-11-01", now: "2026-11-01T08:30:00Z" }),
      P6_CODES.SLOT_NOT_DUE,
    );
    const receipt = await engine.runConsolidation({ runDate: "2026-11-01", now: "2026-11-01T09:00:00Z" });
    expect(receipt.slotInstant).toBe("2026-11-01T09:00:00.000Z");
  });
});
