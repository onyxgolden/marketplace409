// Team Brain P6 — consolidation / replay engine.
//
// Ordered steps (GS-P6; parent contract §4 limits + §6 70/30 mix):
//   1. Snapshot source watermark
//   2. Bounded deterministic recent/older replay selection
//   3. Source/grant verification and typed duplicate/conflict detection
//   4. Closed-schema proposed actions
//   5. Guarded permitted apply through a real DB role
//   6. Fenced checkpoints, counts/receipts, audit export
//
// Promote only verified uncontested typed event facts. Conflicts,
// standing rules, and permission changes remain proposals for Jason,
// never auto-applied. Episode text is evidence, never authority.
//
// Fix round 1 (ChatGPT NEEDS CHANGES 2026-10-31, TBP6-001..007) changed
// the engine's trust model in seven places; each is marked below:
//   - 001: runs are bound to a visibility principal. A stored receipt
//     replays only to its own principal; receipt/audit reads check
//     the same binding; reverify scans only principal-authorized
//     facts. No denied id, count, or text leaks through replay,
//     archive, receipt, or audit paths.
//   - 002: a run binding is written before any step work (principal,
//     slot, settings, source revision). Retries resume the BOUND
//     inputs instead of recomputing from latest state, so a crash
//     plus new captures cannot drift the receipt away from its
//     checkpoint. The finalize pair (run row + RUN_COMPLETED audit)
//     commits in one transaction, and a replay reconciles a missing
//     terminal audit row if one is ever found.
//   - 003: MISSED is terminal; fresh execution runs only on its own
//     Chicago civil date; a long outage (baseline older than the
//     lookback) is recorded explicitly instead of treated as a
//     first-ever run. Only a stored INCOMPLETE run resumes, and
//     only from its bound snapshot.
//   - 004: a later authorized conflict retires the currency of
//     earlier CONFLICT_FREE facts (state SUPERSEDED, row retained).
//     History is preserved; current reads never present an
//     unresolved fact as currently uncontested.
//   - 005: duplicate identity is the canonical typed identity
//     (scope + source lineage + visibility + grants + normalized
//     text), compared exactly on identifiers. Mere text similarity
//     is filed as a similarity proposal and suppresses nothing.
//   - 006: execution identity comes from the database connection
//     itself (SELECT current_user), never from a per-run label.
//     The role option is gone: a connection that is not the
//     consolidator role is refused with ROLE_DENIED before any
//     write, and apply re-checks on the step client. Real roles are
//     proven in an isolated database (PGlite CREATE/SET ROLE).
//   - 007: budgets are trusted engine-creation config, versioned and
//     bound to the run. The per-run limit may not exceed the
//     configured selection cap. Consulted objects/bytes and the
//     processing deadline are charged as work is materialized;
//     exhaustion stops the run as INCOMPLETE with a stable
//     continuation (step + cursor) instead of COMPLETED success or
//     dropped remainder. A later attempt resumes from the
//     continuation under the same bound inputs.
//
// Boundaries (hard, same as P5 plus this slice):
//   - In-process only (001A). The lease row is cooperative, not
//     cross-process fencing. Two writers in different processes may
//     still race; the engine refuses a second holder only when it
//     can see the lease row, and never claims exclusion it cannot
//     prove. No worker, no activation, no deployment, no production
//     migration, no spend.
//   - Exclusion: tenant, ledger/financial, enrollment, scheduling
//     records are refused and excluded, same scope list as P5.
//   - Archive-without-delete: facts and episodes are never deleted.
//     Archiving flips a state flag + note only.
//   - One logical 03:00 America/Chicago run per civil date.
//     Due-slot logic only; a missed slot is recorded MISSED, never
//     silently backfilled.
//   - Least privilege: only the database role named at engine
//     creation (default tb_consolidator) may apply, proven by the
//     connection's own current_user — never by a caller label.
//
// Step atomicity, stated honestly: steps run sequentially on one
// physical connection (checked-out client for pools, the handle for
// single connections), and every step write is idempotent
// (ON CONFLICT DO NOTHING / conditional UPDATE), so a crash leaves
// either a completed step or a resumable prefix, and a resume from
// bound inputs converges to one logical outcome. The terminal pair
// (COMPLETED run row + RUN_COMPLETED audit) commits in a single
// explicit transaction. Cross-process fencing remains out of scope
// (001A); the lease is cooperative.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODES, fail } from "../ledger/errors.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import { FORBIDDEN_SCOPES } from "../retrieval/repository.mjs";
import { P6_CODES } from "./errors.mjs";
import {
  assertCivilDate,
  civilDateInChicago,
  isSlotDue,
  slotInstantForCivilDate,
} from "./scheduling.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CONSOLIDATOR_ROLE = "tb_consolidator";
export const DEFAULT_SELECTION_LIMIT = 50;
export const RECENT_WINDOW_DAYS = 30;
export const MISSED_LOOKBACK_DAYS = 30;
export const CHECKPOINTS = [
  "SNAPSHOT",
  "SELECTION",
  "VERIFICATION",
  "PROPOSALS",
  "APPLY",
  "EXPORT",
];
const STEP_ORDER = ["BOUND", ...CHECKPOINTS, "DONE"];

// Trusted budgets (fix round 1, TBP6-007). Host-owned engine-creation
// config, never per-run options: a caller that passes a bigger limit
// gets LIMIT_EXCEEDED, not a bigger run. Versioned so a maxima change
// is visible in bindings and receipts; a resume under different
// budgets is refused as a binding mismatch.
export const DEFAULT_BUDGETS = {
  version: 1,
  selectionLimitMax: 50,
  consultedObjectMax: 1000,
  consultedByteMax: 5000000,
  deadlineMs: 120000,
};
const SNAPSHOT_PAGE_SIZE = 100;
const SELECTION_PAGE_SIZE = 100;
const REVERIFY_PAGE_SIZE = 100;

// Closed fact schema. A fact is a deterministic derivation from a
// verified uncontested episode — never free text, never a model
// output. One row per (episode, fact type).
export const FACT_TYPES = [
  "EPISODE_RECORDED",
  "SOURCE_VERIFIED",
  "SCOPE_CLASSIFIED",
  "CONFLICT_FREE",
  "DUPLICATE_CANONICAL",
];

// Closed proposal schema. CONFLICT and DUPLICATE are filed by replay.
// STANDING_RULE and PERMISSION_CHANGE are NEVER filed from replay
// and require an authorization record on the explicit filing path.
export const PROPOSAL_TYPES = [
  "CONFLICT",
  "DUPLICATE",
  "STANDING_RULE",
  "PERMISSION_CHANGE",
];

export function loadP6SchemaSql() {
  return readFileSync(join(HERE, "schema.sql"), "utf8");
}

export async function migrateP6(db) {
  if (!db || typeof db.exec !== "function") {
    fail(
      P6_CODES.UNSUPPORTED_HANDLE,
      "migrateP6 requires a handle with exec(sql) (PGlite-style single connection)",
      {},
    );
  }
  // The facts table references P5's tb_episodes. Check first so a
  // missing P5 schema fails with a named prerequisite error instead
  // of a cryptic 42P01 from inside the multi-statement exec.
  if (typeof db.query === "function") {
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'tb_episodes'",
    );
    if (!rows.length) {
      fail(
        P6_CODES.MISSING_PREREQUISITE,
        "P6 schema requires the P5 schema first (tb_episodes missing) — apply retrieval/schema.sql before consolidation/schema.sql",
        {},
      );
    }
  }
  await db.exec(loadP6SchemaSql());
}

function sha32(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function normalizeText(s) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDuplicateKey(title, body) {
  return `${normalizeText(title)}\n${normalizeText(body)}`;
}

// Canonical typed duplicate identity (fix round 1, TBP6-005): scope,
// source lineage, visibility, and grants compared EXACTLY (they are
// identifiers, never lowercased); only the prose is normalized.
// Equal prose with different scope, source, visibility, or grants is
// similarity, not duplication.
function typedDuplicateKey(row) {
  return stableStringify({
    scope: row.scope,
    sourceRepo: row.source_repo,
    sourcePath: row.source_path,
    sourceCommit: row.source_commit,
    sourceBlob: row.source_blob,
    visibility: row.visibility,
    grants: row.grant_principals ?? "",
    title: normalizeText(row.title),
    body: normalizeText(row.body),
  });
}

function factIdFor(episodeId, factType) {
  return `fact-${sha32(`${episodeId}:${factType}`)}`;
}

function proposalIdFor(kind, key) {
  return `prop-${sha32(`${kind}:${key}`)}`;
}

function assertNonEmptyString(value, what) {
  if (typeof value !== "string" || value === "") {
    fail(CODES.INVALID_FIELD, `${what} must be a non-empty string`, {});
  }
}

// Budget exhaustion is a normal outcome, not an error: the run stops
// as INCOMPLETE with a stable continuation. Steps throw it; the run
// driver catches it and persists the INCOMPLETE state. It is
// deliberately NOT a TeamBrainError — callers distinguish a refused
// run (thrown, typed) from an incomplete one (returned).
class BudgetStop extends Error {
  constructor(reason, step) {
    super(`budget stop: ${reason} at ${step}`);
    this.name = "BudgetStop";
    this.reason = reason;
    this.step = step;
  }
}

// In-process serialization, same shape as P5 (fix round 1, TBP5-002):
// one promise chain per db handle, shared by every engine instance on
// that handle. The chain never breaks on error.
const CONNECTION_LOCKS = new WeakMap();
function connectionLock(dbHandle) {
  let entry = CONNECTION_LOCKS.get(dbHandle);
  if (!entry) {
    entry = { tail: Promise.resolve() };
    CONNECTION_LOCKS.set(dbHandle, entry);
  }
  return (fn) => {
    const run = entry.tail.then(fn);
    entry.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function isPoolLikeHandle(dbHandle) {
  return (
    typeof dbHandle.connect === "function" &&
    (typeof dbHandle.totalCount === "number" ||
      typeof dbHandle.idleCount === "number" ||
      typeof dbHandle.waitingCount === "number")
  );
}

function assertQueryHandle(dbHandle) {
  if (!dbHandle || typeof dbHandle.query !== "function") {
    fail(
      P6_CODES.UNSUPPORTED_HANDLE,
      "db handle must expose async query(sql, params)",
      {},
    );
  }
}

// Single statements (lease acquire/release) are atomic on any
// connection, so they run on the handle itself. Multi-statement step
// sequences run on one checked-out client for pool-like handles
// (P5 fix round 2, TBP5-008), or on the handle for single
// connections. A pool whose connect() yields no usable client fails
// loudly instead of silently claiming transactional durability.
async function withStepClient(dbHandle, fn) {
  if (!isPoolLikeHandle(dbHandle)) return fn(dbHandle);
  const client = await dbHandle.connect();
  if (
    !client ||
    typeof client.query !== "function" ||
    typeof client.release !== "function"
  ) {
    fail(
      P6_CODES.UNSUPPORTED_HANDLE,
      "pool connect() must yield a client with query() and release()",
      {},
    );
  }
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Charge one materialized row against the run's trusted budgets.
// Throws BudgetStop BEFORE the row is processed, so the caller's
// cursor stays at the last completed row and the row is retried on
// the next attempt. One documented exception: a single row larger
// than the entire byte budget is processed anyway — otherwise it
// could never be processed at all. The budget bounds aggregate work
// across a run, not single rows.
function chargeRow(ctx, row) {
  const bytes = stableStringify(row).length;
  if (ctx.charge.objects + 1 > ctx.budgets.consultedObjectMax) {
    throw new BudgetStop("OBJECT_BUDGET", ctx.currentStep);
  }
  if (
    ctx.charge.bytes + bytes > ctx.budgets.consultedByteMax &&
    bytes <= ctx.budgets.consultedByteMax
  ) {
    throw new BudgetStop("BYTE_BUDGET", ctx.currentStep);
  }
  ctx.charge.objects += 1;
  ctx.charge.bytes += bytes;
}

// Charge one written row (fact, proposal, supersede, archive).
function chargeWrite(ctx, byteLength) {
  if (ctx.charge.objects + 1 > ctx.budgets.consultedObjectMax) {
    throw new BudgetStop("OBJECT_BUDGET", ctx.currentStep);
  }
  if (
    ctx.charge.bytes + byteLength > ctx.budgets.consultedByteMax &&
    byteLength <= ctx.budgets.consultedByteMax
  ) {
    throw new BudgetStop("BYTE_BUDGET", ctx.currentStep);
  }
  ctx.charge.objects += 1;
  ctx.charge.bytes += byteLength;
}

function checkDeadline(ctx) {
  if (ctx.clock() - ctx.startClock > ctx.budgets.deadlineMs) {
    throw new BudgetStop("DEADLINE", ctx.currentStep);
  }
}

export function createConsolidationEngine(db, options = {}) {
  assertQueryHandle(db);
  // Trusted adapter configuration (fix round 1, TBP6-006/007). The
  // consolidator role NAME is deployment config; the AUTHORITY is
  // always the connection's own current_user, checked at run start
  // and re-checked at apply. Budgets are host-owned maxima, never
  // per-run options. The clock is injectable so deadline enforcement
  // is testable without wall-clock flakiness; production uses
  // Date.now for deadline checks only (recorded timestamps still
  // come from the caller's `now` input, keeping runs deterministic).
  const consolidatorRole =
    typeof options.consolidatorRole === "string" && options.consolidatorRole !== ""
      ? options.consolidatorRole
      : CONSOLIDATOR_ROLE;
  const budgets = { ...DEFAULT_BUDGETS, ...(options.budgets ?? {}) };
  const clock = typeof options.clock === "function" ? options.clock : () => Date.now();

  async function currentDbRole(handle) {
    const { rows } = await handle.query("SELECT current_user");
    return rows[0].current_user;
  }

  async function latestRevisionOn(tx) {
    const { rows } = await tx.query(
      "SELECT revision FROM tb_retrieval_revisions WHERE id = 1",
    );
    return rows.length ? Number(rows[0].revision) : 0;
  }

  // Audit appends are idempotent per (run_date, entry_type,
  // payload hash): a resumed step re-appends the same deterministic
  // payload and the row is kept once. Payloads carry no wall clock;
  // recorded_at does. Without this, a mid-step crash would duplicate
  // audit rows on resume.
  async function audit(tx, runDate, entryType, payload, now) {
    const text = stableStringify(payload);
    await tx.query(
      `INSERT INTO tb_consolidation_audit (run_date, entry_type, payload, payload_hash, recorded_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_date, entry_type, payload_hash) DO NOTHING`,
      [runDate, entryType, text, sha32(text), now],
    );
  }

  async function writeCheckpoint(tx, runDate, checkpoint, counts, now) {
    await tx.query(
      `INSERT INTO tb_consolidation_checkpoints (run_date, checkpoint, counts, recorded_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_date, checkpoint) DO NOTHING`,
      [runDate, checkpoint, stableStringify(counts), now],
    );
  }

  // The INCOMPLETE checkpoint is progress, not history: each stop
  // overwrites it with the latest step/reason/charge so the row
  // always describes the current continuation. Step checkpoints
  // stay insert-only (one payload per step).
  async function writeIncompleteCheckpoint(tx, runDate, counts, now) {
    await tx.query(
      `INSERT INTO tb_consolidation_checkpoints (run_date, checkpoint, counts, recorded_at)
       VALUES ($1, 'INCOMPLETE', $2, $3)
       ON CONFLICT (run_date, checkpoint) DO UPDATE SET
         counts = EXCLUDED.counts, recorded_at = EXCLUDED.recorded_at`,
      [runDate, stableStringify(counts), now],
    );
  }

  // ---- Run bindings (fix round 1, TBP6-002) ----
  // Written before any step work; updated as the run progresses.
  // settings = { limit, budgets } (bound inputs). progress = {
  //   step, snapshotRevision, snapshot {chain,count,cursor,value},
  //   selection {recent,older,fill,picked,value},
  //   verification, proposalsFiled, apply {cursors,outputs},
  //   missedDates, outageBaseline }.
  // A retry reads the binding and resumes the bound work; it never
  // recomputes the snapshot from latest state.
  async function readBinding(tx, runDate) {
    const { rows } = await tx.query(
      "SELECT * FROM tb_consolidation_run_bindings WHERE run_date = $1",
      [runDate],
    );
    if (!rows.length) return null;
    const b = rows[0];
    return {
      runDate: b.run_date,
      principal: b.principal,
      slotInstant: b.slot_instant,
      settings: JSON.parse(b.settings),
      progress: JSON.parse(b.progress),
      leaseGeneration: Number(b.lease_generation),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  }

  async function writeBinding(tx, binding) {
    await tx.query(
      `INSERT INTO tb_consolidation_run_bindings
         (run_date, principal, slot_instant, settings, progress, lease_generation, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_date) DO UPDATE SET
         principal = EXCLUDED.principal, slot_instant = EXCLUDED.slot_instant,
         settings = EXCLUDED.settings, progress = EXCLUDED.progress,
         lease_generation = EXCLUDED.lease_generation, updated_at = EXCLUDED.updated_at`,
      [
        binding.runDate,
        binding.principal,
        binding.slotInstant,
        stableStringify(binding.settings),
        stableStringify(binding.progress),
        binding.leaseGeneration,
        binding.createdAt,
        binding.updatedAt,
      ],
    );
  }

  // An episode is ARCHIVED at a snapshot revision when its row says
  // ARCHIVED or an archive event exists at or below the revision
  // (same projection rule as P5).
  async function archivedIdsAt(tx, episodeIds, snapshotRevision) {
    if (!episodeIds.length) return new Set();
    const { rows } = await tx.query(
      `SELECT e.episode_id FROM tb_episodes e
       WHERE e.episode_id = ANY($1)
       AND (e.state = 'ARCHIVED' OR EXISTS (
         SELECT 1 FROM tb_episode_events ev
         WHERE ev.episode_id = e.episode_id AND ev.event_type = 'ARCHIVED'
         AND ev.revision <= $2
       ))`,
      [episodeIds, snapshotRevision],
    );
    return new Set(rows.map((r) => r.episode_id));
  }

  // Authorization filter shared by snapshot, selection, conflict
  // counterparts, and reverify: public, or granted to the run
  // principal. Forbidden scopes are excluded even on direct inserts.
  // Denied episodes are invisible to counts, fingerprints, and
  // diagnostics alike. The SQL references alias `e` and takes the
  // principal at parameter $principalIndex.
  function authWhere(principalIndex) {
    return `e.scope NOT IN ('tenant', 'ledger', 'financial', 'enrollment', 'scheduling')
      AND (e.visibility = 'public' OR EXISTS (
        SELECT 1 FROM tb_episode_grants g
        WHERE g.episode_id = e.episode_id AND g.principal = $${principalIndex}
      ))`;
  }

  // Step 1 — snapshot, paged. The run's source watermark is a
  // deterministic fingerprint over the authorized episodes at the
  // BOUND revision (episode id + episode revision + source
  // watermark, sorted), plus the authorized count. Same bound
  // inputs always yield the same fingerprint; denied episodes
  // contribute nothing. Paging is by episode_id with an incremental
  // hash chain persisted in the binding, so a budget stop mid-scan
  // resumes from its cursor instead of restarting.
  async function stepSnapshot(ctx) {
    const p = ctx.progress;
    if (p.snapshot?.value) return p.snapshot.value;
    ctx.currentStep = "SNAPSHOT";
    checkDeadline(ctx);
    let chain = p.snapshot?.chain ?? "";
    let count = p.snapshot?.count ?? 0;
    let cursor = p.snapshot?.cursor ?? "";
    const revision = p.snapshotRevision;
    for (;;) {
      checkDeadline(ctx);
      const { rows } = await ctx.tx.query(
        `SELECT e.episode_id, e.revision, e.source_watermark FROM tb_episodes e
         WHERE e.revision <= $1 AND ${authWhere(2)} AND e.episode_id > $3
         ORDER BY e.episode_id ASC LIMIT $4`,
        [revision, ctx.principal, cursor, SNAPSHOT_PAGE_SIZE],
      );
      // Charge and fold one page, persisting progress after EVERY
      // row. Per-page persistence would stall when a page is bigger
      // than the budget: the stop would discard the page and the
      // next attempt would hit the same wall. Per-row persistence
      // guarantees at least one row of progress per attempt.
      for (const row of rows) {
        chargeRow(ctx, row);
        chain = sha32(
          `${chain}|${stableStringify([row.episode_id, Number(row.revision), row.source_watermark])}`,
        );
        count += 1;
        cursor = row.episode_id;
        p.snapshot = { chain, count, cursor };
        p.step = "BOUND";
        await ctx.saveProgress();
      }
      if (rows.length < SNAPSHOT_PAGE_SIZE) break;
    }
    const value = { revision, watermark: chain, episodeCount: count };
    p.snapshot = { chain, count, cursor, value };
    p.step = "SNAPSHOT";
    await ctx.saveProgress();
    await audit(ctx.tx, ctx.runDate, "SNAPSHOT", value, ctx.now);
    await writeCheckpoint(ctx.tx, ctx.runDate, "SNAPSHOT", value, ctx.now);
    return value;
  }

  // Step 2 — bounded deterministic selection, 70/30 recent/older mix
  // (parent contract §6 starting setting). Recent = captured within
  // 30 days before the slot instant; older = before that. Each side
  // orders captured_at_ms DESC, episode_id ASC; the merged selection
  // keeps that order. A short side is filled from the other side;
  // the total never exceeds the limit. ARCHIVED-at-snapshot
  // episodes are excluded here; their previously promoted facts are
  // handled by the apply step's reverify, not by re-selection.
  // Each side pages independently with keyset cursors persisted in
  // the binding, so a budget stop resumes per side instead of
  // restarting the mix.
  async function stepSelection(ctx, snapshot) {
    const p = ctx.progress;
    if (p.selection?.value) {
      return { picked: p.selection.picked, selection: p.selection.value };
    }
    ctx.currentStep = "SELECTION";
    checkDeadline(ctx);
    const slotMs = Date.parse(ctx.slotInstant);
    const recentCutoff = slotMs - RECENT_WINDOW_DAYS * 86400 * 1000;
    const limit = ctx.settings.limit;
    const recentTarget = Math.floor(limit * 0.7);
    const olderTarget = limit - recentTarget;
    const sel = p.selection ?? {
      recent: { cursor: null, rows: [], done: false },
      older: { cursor: null, rows: [], done: false },
      fill: { cursor: null, rows: [], done: false },
    };
    const cols = `e.episode_id, e.scope, e.title, e.body, e.source_repo, e.source_path,
      e.source_commit, e.source_blob, e.source_watermark, e.captured_at,
      e.captured_at_ms, e.revision, e.state, e.visibility,
      e.provenance_status, e.conflict_group,
      (SELECT COALESCE(string_agg(g.principal, ',' ORDER BY g.principal), '')
       FROM tb_episode_grants g WHERE g.episode_id = e.episode_id) AS grant_principals`;
    const activeWhere = `e.revision <= $1 AND ${authWhere(2)} AND NOT (e.state = 'ARCHIVED' OR EXISTS (
      SELECT 1 FROM tb_episode_events ev
      WHERE ev.episode_id = e.episode_id AND ev.event_type = 'ARCHIVED'
      AND ev.revision <= $1
    ))`;
    const order = "ORDER BY e.captured_at_ms DESC, e.episode_id ASC";
    // Page one side. Keyset: (captured_at_ms, episode_id) with ms
    // DESC, id ASC — the next page is ms < lastMs, or ms = lastMs
    // with id > lastId. A NULL cursor disables the keyset clause.
    // Each side builds its own parameter list: Postgres rejects a
    // passed-but-unreferenced parameter (42P18), so fill — which
    // has no cutoff — uses shifted positions instead of a dummy.
    async function pageSide(side, target) {
      const st = sel[side];
      while (!st.done) {
        checkDeadline(ctx);
        const remaining = target - st.rows.length;
        if (remaining <= 0) {
          st.done = true;
          break;
        }
        const pageLimit = Math.min(remaining, SELECTION_PAGE_SIZE);
        let rows;
        if (side === "fill") {
          const pickedIds = [
            ...sel.recent.rows.map((r) => r.episode_id),
            ...sel.older.rows.map((r) => r.episode_id),
            ...st.rows.map((r) => r.episode_id),
          ];
          ({ rows } = await ctx.tx.query(
            `SELECT ${cols} FROM tb_episodes e
             WHERE ${activeWhere} AND ($3::bigint IS NULL OR e.captured_at_ms < $3 OR (e.captured_at_ms = $3 AND e.episode_id > $4)) AND NOT (e.episode_id = ANY($6))
             ${order} LIMIT $5`,
            [
              snapshot.revision,
              ctx.principal,
              st.cursor ? st.cursor.ms : null,
              st.cursor ? st.cursor.id : "",
              pageLimit,
              pickedIds,
            ],
          ));
        } else {
          const cutoffClause = side === "recent" ? "AND e.captured_at_ms >= $3" : "AND e.captured_at_ms < $3";
          ({ rows } = await ctx.tx.query(
            `SELECT ${cols} FROM tb_episodes e
             WHERE ${activeWhere} ${cutoffClause} AND ($4::bigint IS NULL OR e.captured_at_ms < $4 OR (e.captured_at_ms = $4 AND e.episode_id > $5))
             ${order} LIMIT $6`,
            [
              snapshot.revision,
              ctx.principal,
              recentCutoff,
              st.cursor ? st.cursor.ms : null,
              st.cursor ? st.cursor.id : "",
              pageLimit,
            ],
          ));
        }
        // Charge and append one page, persisting progress after
        // EVERY row (same no-stall reason as the snapshot scan).
        for (const row of rows) {
          chargeRow(ctx, row);
          st.rows.push(row);
          st.cursor = { ms: Number(row.captured_at_ms), id: row.episode_id };
          p.selection = sel;
          await ctx.saveProgress();
        }
        if (rows.length < pageLimit || st.rows.length >= target) {
          st.done = true;
        }
      }
    }
    // Fill needs the recent+older totals first, so sides run in
    // order. Their row sets are disjoint (cutoff split), and fill
    // excludes everything already picked.
    await pageSide("recent", recentTarget);
    await pageSide("older", olderTarget);
    const pickedSoFar = sel.recent.rows.length + sel.older.rows.length;
    await pageSide("fill", limit - pickedSoFar + sel.fill.rows.length);
    // The fill target above is limit minus already-picked, plus
    // fill rows already banked, so the loop ends exactly at limit.
    let picked = [...sel.recent.rows, ...sel.older.rows, ...sel.fill.rows];
    picked.sort(
      (a, b) =>
        Number(b.captured_at_ms) - Number(a.captured_at_ms) ||
        (a.episode_id < b.episode_id ? -1 : a.episode_id > b.episode_id ? 1 : 0),
    );
    picked = picked.slice(0, limit);
    const recentCount = picked.filter((r) => Number(r.captured_at_ms) >= recentCutoff).length;
    const selection = {
      limit,
      recent: recentCount,
      older: picked.length - recentCount,
      total: picked.length,
      episodeIds: picked.map((r) => r.episode_id),
    };
    p.selection = { ...sel, picked, value: selection };
    p.step = "SELECTION";
    await ctx.saveProgress();
    await audit(ctx.tx, ctx.runDate, "SELECTION", selection, ctx.now);
    await writeCheckpoint(ctx.tx, ctx.runDate, "SELECTION", selection, ctx.now);
    return { picked, selection };
  }

  // Step 3 — verification + typed detection. An episode promotes
  // only when it passes every gate: complete provenance, no
  // multi-member authorized conflict group, not a later typed
  // duplicate. Conflict counterparts are fetched per group in
  // sorted group order with progress persisted per group, so a
  // budget stop resumes at the next group instead of restarting.
  // Duplicate identity is typed (fix round 1, TBP6-005); mere text
  // similarity is recorded separately and suppresses nothing.
  async function stepVerification(ctx, snapshot, picked) {
    const p = ctx.progress;
    if (p.verification) return p.verification;
    ctx.currentStep = "VERIFICATION";
    checkDeadline(ctx);
    const groups = [...new Set(picked.map((r) => r.conflict_group).filter(Boolean))].sort();
    const vprog = p.verificationProgress ?? { groupCursor: null, groupMembers: {} };
    const groupMembers = new Map(Object.entries(vprog.groupMembers).map(([k, v]) => [k, v]));
    for (const group of groups) {
      if (vprog.groupCursor !== null && group <= vprog.groupCursor) continue;
      checkDeadline(ctx);
      const { rows } = await ctx.tx.query(
        `SELECT conflict_group, episode_id FROM tb_episodes e
         WHERE e.conflict_group = $1 AND e.revision <= $2
         AND ${authWhere(3)}
         ORDER BY episode_id ASC`,
        [group, snapshot.revision, ctx.principal],
      );
      // A single conflict group is the atomic unit of conflict
      // detection: if its member list alone exceeds the object
      // budget, it is still processed whole (documented exception,
      // same family as the single-row byte exception). Otherwise a
      // large group could never complete. Normal groups stop before
      // exceeding, via chargeRow.
      const groupExceedsBudget = rows.length > ctx.budgets.consultedObjectMax;
      for (const row of rows) {
        if (groupExceedsBudget) {
          ctx.charge.objects += 1;
          ctx.charge.bytes += stableStringify(row).length;
        } else {
          chargeRow(ctx, row);
        }
      }
      groupMembers.set(group, rows.map((r) => r.episode_id));
      vprog.groupCursor = group;
      vprog.groupMembers = Object.fromEntries(groupMembers);
      p.verificationProgress = vprog;
      await ctx.saveProgress();
    }
    const conflicts = [];
    const conflictedIds = new Set();
    for (const [group, members] of groupMembers) {
      if (members.length > 1) {
        conflicts.push({ group, members: [...members] });
        for (const id of members) conflictedIds.add(id);
      }
    }
    const skipped = [];
    const duplicates = [];
    const promoted = [];
    const seenTypedKeys = new Map();
    for (const row of picked) {
      const episodeId = row.episode_id;
      if (row.provenance_status !== "COMPLETE") {
        skipped.push({ episodeId, reason: "UNAVAILABLE_PROVENANCE" });
        continue;
      }
      if (conflictedIds.has(episodeId)) {
        skipped.push({ episodeId, reason: "CONFLICT_UNRESOLVED" });
        continue;
      }
      const key = typedDuplicateKey(row);
      if (seenTypedKeys.has(key)) {
        const canonical = seenTypedKeys.get(key);
        let entry = duplicates.find((d) => d.key === key);
        if (!entry) {
          entry = { key, canonical, duplicates: [] };
          duplicates.push(entry);
        }
        entry.duplicates.push(episodeId);
        skipped.push({ episodeId, reason: "DUPLICATE_OF_CANONICAL" });
        continue;
      }
      seenTypedKeys.set(key, episodeId);
      promoted.push({
        episodeId,
        scope: row.scope,
        conflictGroup: row.conflict_group,
        isDuplicateCanonical: false,
      });
    }
    // A canonical that later gained duplicates still counts as
    // canonical: recompute after the full pass.
    const canonicalIds = new Set(duplicates.map((d) => d.canonical));
    for (const pr of promoted) pr.isDuplicateCanonical = canonicalIds.has(pr.episodeId);
    // Text similarity without typed identity: a proposal signal,
    // never a suppression. Groups share normalized prose but differ
    // in scope, source, visibility, or grants.
    const byText = new Map();
    for (const row of picked) {
      const textKey = normalizeDuplicateKey(row.title, row.body);
      if (!byText.has(textKey)) byText.set(textKey, []);
      byText.get(textKey).push(row);
    }
    const similarities = [];
    for (const [textKey, rows] of byText) {
      const typedKeys = [...new Set(rows.map((r) => typedDuplicateKey(r)))];
      if (typedKeys.length > 1) {
        similarities.push({
          key: textKey,
          episodes: rows.map((r) => r.episode_id),
          typedKeys,
        });
      }
    }
    const verification = {
      promoted: promoted.map((pr) => pr.episodeId),
      skipped,
      conflicts,
      duplicates,
      similarities,
    };
    p.verification = verification;
    p.verificationDetail = { promoted, conflicts };
    p.step = "VERIFICATION";
    await ctx.saveProgress();
    await audit(ctx.tx, ctx.runDate, "VERIFICATION", verification, ctx.now);
    await writeCheckpoint(ctx.tx, ctx.runDate, "VERIFICATION", verification, ctx.now);
    return verification;
  }

  // Step 4 — closed-schema proposed actions, persisted. CONFLICT
  // proposals carry the authorized member list; DUPLICATE proposals
  // carry canonical + duplicates, or similarityOnly with the similar
  // episodes and an empty suppressed list. Re-filing an identical
  // proposal replays (ON CONFLICT DO NOTHING). Proposals are OPEN
  // until Jason closes them; the engine never closes one. Filed ids
  // persist per proposal in the binding so a budget stop resumes
  // without re-filing.
  async function stepProposals(ctx, snapshot, verification) {
    const p = ctx.progress;
    if (p.proposalsFiled) return { filed: p.proposalsFiled };
    ctx.currentStep = "PROPOSALS";
    checkDeadline(ctx);
    const filed = p.proposalsFiledProgress ?? [];
    async function fileOne(id, type, episodeId, group, detail) {
      if (filed.includes(id)) return;
      chargeWrite(ctx, stableStringify(detail).length);
      await ctx.tx.query(
        `INSERT INTO tb_consolidation_proposals
           (proposal_id, proposal_type, episode_id, conflict_group, detail, authorization_id, status, filed_run_date, filed_at)
         VALUES ($1, $2, $3, $4, $5, NULL, 'OPEN', $6, $7)
         ON CONFLICT (proposal_id) DO NOTHING`,
        [id, type, episodeId, group, stableStringify(detail), ctx.runDate, ctx.now],
      );
      filed.push(id);
      p.proposalsFiledProgress = filed;
      await ctx.saveProgress();
    }
    for (const conflict of verification.conflicts) {
      const id = proposalIdFor("CONFLICT", `${conflict.group}:${[...conflict.members].sort().join(",")}`);
      await fileOne(id, "CONFLICT", null, conflict.group, {
        type: "CONFLICT",
        group: conflict.group,
        members: [...conflict.members].sort(),
        snapshotRevision: snapshot.revision,
      });
    }
    for (const dup of verification.duplicates) {
      const id = proposalIdFor("DUPLICATE", `${dup.key}:${dup.canonical}:${[...dup.duplicates].sort().join(",")}`);
      await fileOne(id, "DUPLICATE", dup.canonical, null, {
        type: "DUPLICATE",
        canonical: dup.canonical,
        duplicates: [...dup.duplicates].sort(),
        snapshotRevision: snapshot.revision,
      });
    }
    for (const sim of verification.similarities) {
      const sorted = [...sim.episodes].sort();
      const id = proposalIdFor("DUPLICATE", `similarity:${sim.key}:${sorted.join(",")}`);
      await fileOne(id, "DUPLICATE", null, null, {
        type: "DUPLICATE",
        similarityOnly: true,
        textKey: sim.key,
        episodes: sorted,
        suppressed: [],
        snapshotRevision: snapshot.revision,
      });
    }
    const proposals = { filed };
    p.proposalsFiled = filed;
    p.step = "PROPOSALS";
    await ctx.saveProgress();
    await audit(ctx.tx, ctx.runDate, "PROPOSALS", proposals, ctx.now);
    await writeCheckpoint(ctx.tx, ctx.runDate, "PROPOSALS", proposals, ctx.now);
    return proposals;
  }

  // Step 5 — guarded apply. The database role is re-checked on the
  // step client even though runConsolidation checks it up front: no
  // fact row is ever written by a non-consolidator connection,
  // through any path. Promoted facts are inserted idempotently.
  // Then, in order: (a) earlier CONFLICT_FREE facts whose group has
  // newly become multi-member in the authorized view are retired to
  // SUPERSEDED (history retained, currency gone — fix round 1,
  // TBP6-004); (b) reverify archives facts whose source episode is
  // ARCHIVED at the snapshot, scoped to principal-authorized facts
  // only (fix round 1, TBP6-001) — never a DELETE. Promotion,
  // supersede, and reverify each persist progress per unit so a
  // budget stop resumes without redoing completed units.
  async function stepApply(ctx, snapshot, verification) {
    const p = ctx.progress;
    if (p.apply?.output) return p.apply.output;
    ctx.currentStep = "APPLY";
    checkDeadline(ctx);
    const dbRole = await currentDbRole(ctx.tx);
    if (dbRole !== consolidatorRole) {
      fail(P6_CODES.ROLE_DENIED, `apply requires database role ${consolidatorRole}, got ${dbRole}`, { role: dbRole });
    }
    const aprog = p.apply ?? {
      promotedDone: 0,
      conflictCursor: null,
      reverifyCursor: "",
      factIds: [],
      archivedFactIds: [],
      supersededFactIds: [],
    };
    const promotedDetail = p.verificationDetail.promoted;
    for (let pi = 0; pi < promotedDetail.length; pi += 1) {
      if (pi < aprog.promotedDone) continue;
      const pr = promotedDetail[pi];
      checkDeadline(ctx);
      // Every promoted episode is uncontested in the authorized
      // view (multi-member groups were skipped at verification), so
      // every promoted episode earns CONFLICT_FREE. A canonical of a
      // duplicate set additionally earns DUPLICATE_CANONICAL.
      const types = ["EPISODE_RECORDED", "SOURCE_VERIFIED", "SCOPE_CLASSIFIED", "CONFLICT_FREE"];
      if (pr.isDuplicateCanonical) types.push("DUPLICATE_CANONICAL");
      for (const factType of types) {
        const factId = factIdFor(pr.episodeId, factType);
        const value = stableStringify({
          episodeId: pr.episodeId,
          scope: pr.scope,
          factType,
          snapshotRevision: snapshot.revision,
        });
        chargeWrite(ctx, value.length);
        await ctx.tx.query(
          `INSERT INTO tb_consolidated_facts
             (fact_id, episode_id, fact_type, fact_key, fact_value, promoted_revision, promoted_run_date, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
           ON CONFLICT (fact_id) DO NOTHING`,
          [factId, pr.episodeId, factType, pr.episodeId, value, snapshot.revision, ctx.runDate],
        );
        if (!aprog.factIds.includes(factId)) aprog.factIds.push(factId);
      }
      aprog.promotedDone = pi + 1;
      p.apply = aprog;
      await ctx.saveProgress();
    }
    // (a) Supersede stale CONFLICT_FREE currency.
    for (const conflict of verification.conflicts) {
      if (aprog.conflictCursor !== null && conflict.group <= aprog.conflictCursor) continue;
      checkDeadline(ctx);
      const { rows } = await ctx.tx.query(
        `UPDATE tb_consolidated_facts
         SET state = 'SUPERSEDED', superseded_note = $2, superseded_at = $3
         WHERE fact_type = 'CONFLICT_FREE' AND episode_id = ANY($1) AND state = 'ACTIVE'
         RETURNING fact_id`,
        [conflict.members, "A later authorized conflict retired this fact's currency as a current assertion.", ctx.now],
      );
      for (const row of rows) {
        chargeWrite(ctx, 0);
        if (!aprog.supersededFactIds.includes(row.fact_id)) aprog.supersededFactIds.push(row.fact_id);
      }
      aprog.conflictCursor = conflict.group;
      p.apply = aprog;
      await ctx.saveProgress();
    }
    // (b) Reverify, paged over ACTIVE facts joined to authorized
    // episodes only. A denied principal's facts are never scanned,
    // archived, or reported here. Progress persists after EVERY
    // row (same no-stall reason as the snapshot scan): the cursor
    // advances past each examined row, archived or not.
    for (;;) {
      checkDeadline(ctx);
      const { rows: liveFacts } = await ctx.tx.query(
        `SELECT f.fact_id, f.episode_id FROM tb_consolidated_facts f
         JOIN tb_episodes e ON e.episode_id = f.episode_id
         WHERE f.state = 'ACTIVE' AND f.fact_id > $1 AND ${authWhere(2)}
         ORDER BY f.fact_id ASC LIMIT $3`,
        [aprog.reverifyCursor, ctx.principal, REVERIFY_PAGE_SIZE],
      );
      if (!liveFacts.length) break;
      const archived = await archivedIdsAt(
        ctx.tx,
        liveFacts.map((r) => r.episode_id),
        snapshot.revision,
      );
      for (const row of liveFacts) {
        chargeRow(ctx, row);
        if (archived.has(row.episode_id)) {
          chargeWrite(ctx, 0);
          await ctx.tx.query(
            `UPDATE tb_consolidated_facts
             SET state = 'ARCHIVED', archived_note = $2, archived_actor = $3, archived_at = $4
             WHERE fact_id = $1 AND state = 'ACTIVE'`,
            [row.fact_id, "Source episode archived at consolidation snapshot.", consolidatorRole, ctx.now],
          );
          if (!aprog.archivedFactIds.includes(row.fact_id)) aprog.archivedFactIds.push(row.fact_id);
        }
        aprog.reverifyCursor = row.fact_id;
        p.apply = aprog;
        await ctx.saveProgress();
      }
      if (liveFacts.length < REVERIFY_PAGE_SIZE) break;
    }
    const apply = {
      factIds: aprog.factIds,
      archivedFactIds: aprog.archivedFactIds,
      supersededFactIds: aprog.supersededFactIds,
    };
    p.apply = { ...aprog, output: apply };
    p.step = "APPLY";
    await ctx.saveProgress();
    await audit(ctx.tx, ctx.runDate, "APPLY", apply, ctx.now);
    await writeCheckpoint(ctx.tx, ctx.runDate, "APPLY", apply, ctx.now);
    return apply;
  }

  // Explicit filing path for the two guarded proposal types. STANDING
  // RULE and PERMISSION_CHANGE require an authorization record
  // ({ id, note }, both non-empty) — Jason's word, recorded. Without
  // it the filing is refused. CONFLICT/DUPLICATE are replay-only
  // through this path (they are filed by step 4, never by hand).
  // This path writes a proposal row only; it never applies anything.
  async function fileExplicitProposal(proposal, { runDate, now = new Date().toISOString() } = {}) {
    assertCivilDate(runDate);
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
      fail(P6_CODES.INVALID_PROPOSAL, "proposal must be an object", {});
    }
    for (const key of Object.keys(proposal)) {
      if (!["type", "episodeId", "conflictGroup", "detail", "authorization"].includes(key)) {
        fail(P6_CODES.INVALID_PROPOSAL, `proposal has unknown field: ${key}`, { field: key });
      }
    }
    if (!PROPOSAL_TYPES.includes(proposal.type)) {
      fail(P6_CODES.INVALID_PROPOSAL, `unknown proposal type: ${proposal.type}`, {
        type: proposal.type,
      });
    }
    if (proposal.type === "CONFLICT" || proposal.type === "DUPLICATE") {
      fail(
        P6_CODES.INVALID_PROPOSAL,
        `${proposal.type} proposals are filed by replay only, never by hand`,
        { type: proposal.type },
      );
    }
    if (!proposal.detail || typeof proposal.detail !== "object" || Array.isArray(proposal.detail)) {
      fail(P6_CODES.INVALID_PROPOSAL, "proposal detail must be an object", {});
    }
    const auth = proposal.authorization;
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
      fail(
        P6_CODES.AUTHORIZATION_REQUIRED,
        `${proposal.type} proposals require an authorization record`,
        { type: proposal.type },
      );
    }
    assertNonEmptyString(auth.id, "authorization.id");
    assertNonEmptyString(auth.note, "authorization.note");
    const key = stableStringify({
      type: proposal.type,
      episodeId: proposal.episodeId ?? null,
      conflictGroup: proposal.conflictGroup ?? null,
      detail: proposal.detail,
      authorizationId: auth.id,
    });
    const id = proposalIdFor(proposal.type, key);
    await db.query(
      `INSERT INTO tb_consolidation_proposals
         (proposal_id, proposal_type, episode_id, conflict_group, detail, authorization_id, status, filed_run_date, filed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
       ON CONFLICT (proposal_id) DO NOTHING`,
      [
        id,
        proposal.type,
        proposal.episodeId ?? null,
        proposal.conflictGroup ?? null,
        stableStringify(proposal.detail),
        auth.id,
        runDate,
        now,
      ],
    );
    return { proposalId: id, type: proposal.type, status: "OPEN" };
  }

  // Mark earlier passed slots with no ledger row as MISSED
  // (audit-only; a missed slot is never backfilled). Walk back from
  // the day before and stop at the first COMPLETED row — earlier
  // days were already settled by that run. MISSED and INCOMPLETE
  // rows are transparent to the walk (they already stand) but are
  // never re-added as candidates. If no COMPLETED row exists
  // within the lookback, distinguish first-ever (no rows at all:
  // mark nothing) from a long outage (older rows exist: mark the
  // window and record the older baseline explicitly — fix round 1,
  // TBP6-003). Cap the lookback so one run cannot rewrite history.
  async function markMissed(tx, { runDate, now }) {
    const missed = [];
    let outageBaseline = null;
    const cursor = new Date(`${runDate}T00:00:00Z`);
    let foundCompleted = false;
    const candidates = [];
    for (let i = 0; i < MISSED_LOOKBACK_DAYS; i += 1) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      const day = cursor.toISOString().slice(0, 10);
      const { rows } = await tx.query(
        "SELECT state FROM tb_consolidation_runs WHERE run_date = $1",
        [day],
      );
      if (rows.length && rows[0].state === "COMPLETED") {
        foundCompleted = true;
        break;
      }
      // A day with a binding but no row is a crashed or
      // in-progress run: never mark it MISSED (its own resume
      // owns it), but walk past it like other standing rows.
      if (rows.length) continue;
      const { rows: bindingRows } = await tx.query(
        "SELECT 1 FROM tb_consolidation_run_bindings WHERE run_date = $1",
        [day],
      );
      if (bindingRows.length) continue;
      const daySlot = slotInstantForCivilDate(day);
      if (Date.parse(now) >= Date.parse(daySlot)) candidates.push(day);
    }
    const mark = async (day) => {
      const daySlot = slotInstantForCivilDate(day);
      await tx.query(
        `INSERT INTO tb_consolidation_runs
           (run_date, slot_instant, state, lease_generation, started_at, completed_at)
         VALUES ($1, $2, 'MISSED', 0, $3, $3)
         ON CONFLICT (run_date) DO NOTHING`,
        [day, daySlot, now],
      );
      await audit(tx, day, "RUN_MISSED", { runDate: day, slotInstant: daySlot }, now);
      missed.push(day);
    };
    if (foundCompleted) {
      for (const day of candidates) await mark(day);
    } else {
      const { rows } = await tx.query("SELECT MAX(run_date) AS latest FROM tb_consolidation_runs");
      if (rows.length && rows[0].latest) {
        outageBaseline = rows[0].latest;
        for (const day of candidates) await mark(day);
        await audit(
          tx,
          runDate,
          "RUN_OUTAGE_NOTED",
          { runDate, outageBaseline, windowDays: MISSED_LOOKBACK_DAYS },
          now,
        );
      }
      // Else first-ever run establishing a baseline: mark nothing.
    }
    return { missed, outageBaseline };
  }

  // Full run for one civil date. Order of gates (all before any
  // step write): input validation, database identity, limit cap,
  // slot due. Then the atomic lease acquire (the two-worker
  // arbiter), then the locked step sequence.
  // A COMPLETED run replays its stored receipt without re-running —
  // but only to its own principal (fix round 1, TBP6-001), and a
  // replay reconciles a missing RUN_COMPLETED audit row (TBP6-002).
  // A MISSED date is terminal (TBP6-003). A fresh execution runs
  // only on its own Chicago civil date (TBP6-003); only a stored
  // INCOMPLETE run resumes, and only from its bound inputs.
  // A crashed holder's lease is recovered only with recover:true
  // and the same holder id; otherwise LEASE_HELD.
  async function runConsolidation({
    runDate,
    principal = "consolidator",
    limit = DEFAULT_SELECTION_LIMIT,
    now = new Date().toISOString(),
    holder = `consolidator-${runDate}`,
    recover = false,
  } = {}) {
    assertCivilDate(runDate);
    assertNonEmptyString(principal, "principal");
    if (!Number.isInteger(limit) || limit < 1) {
      fail(CODES.INVALID_FIELD, "limit must be a positive integer", { limit });
    }
    // Execution identity comes from the connection itself (fix
    // round 1, TBP6-006). There is no per-run role option anymore:
    // a caller label can never confer apply authority.
    const dbRole = await currentDbRole(db);
    if (dbRole !== consolidatorRole) {
      fail(
        P6_CODES.ROLE_DENIED,
        `consolidation requires database role ${consolidatorRole}, got ${dbRole}`,
        { role: dbRole },
      );
    }
    // Caller expansion is refused before any write (TBP6-007).
    if (limit > budgets.selectionLimitMax) {
      fail(
        P6_CODES.LIMIT_EXCEEDED,
        `selection limit ${limit} exceeds trusted maximum ${budgets.selectionLimitMax}`,
        { limit, selectionLimitMax: budgets.selectionLimitMax },
      );
    }
    const slotInstant = slotInstantForCivilDate(runDate);
    if (!isSlotDue(runDate, now)) {
      fail(P6_CODES.SLOT_NOT_DUE, `slot ${slotInstant} for ${runDate} has not arrived at ${now}`, {
        runDate,
        slotInstant,
        now,
      });
    }

    // Lease acquire is atomic SQL: exactly one contender wins, even
    // across processes. A normal run takes only a FREE lease. A
    // crashed holder's lease is recovered only with recover:true and
    // the same holder id — never automatically, never by a different
    // holder — so a restart resumes instead of re-applying, and a
    // second worker is refused with LEASE_HELD.
    const acquired = await db.query(
      `UPDATE tb_consolidation_lease
       SET generation = generation + 1, holder = $1, run_date = $2, acquired_at = $3
       WHERE id = 1 AND holder IS NULL
       RETURNING generation`,
      [holder, runDate, now],
    );
    let leaseGeneration;
    if (acquired.rows.length) {
      leaseGeneration = Number(acquired.rows[0].generation);
    } else if (recover) {
      const recovered = await db.query(
        `UPDATE tb_consolidation_lease
         SET generation = generation + 1, acquired_at = $3
         WHERE id = 1 AND holder = $1 AND run_date = $2
         RETURNING generation`,
        [holder, runDate, now],
      );
      if (recovered.rows.length) {
        leaseGeneration = Number(recovered.rows[0].generation);
      } else {
        fail(P6_CODES.LEASE_HELD, `lease held by another holder; recovery requires the same holder id`, {
          runDate,
          holder,
        });
      }
    } else {
      fail(P6_CODES.LEASE_HELD, `consolidation lease is held; another worker owns this run`, {
        runDate,
        holder,
      });
    }

    const withLock = connectionLock(db);
    try {
      return await withLock(async () => {
        return withStepClient(db, async (tx) => {
          const existing = await tx.query(
            "SELECT state, receipt FROM tb_consolidation_runs WHERE run_date = $1",
            [runDate],
          );
          if (existing.rows.length && existing.rows[0].state === "COMPLETED") {
            const stored = JSON.parse(existing.rows[0].receipt);
            const binding = await readBinding(tx, runDate);
            const expectedPrincipal = binding?.principal ?? stored.principal;
            if (principal !== expectedPrincipal) {
              fail(
                P6_CODES.PRINCIPAL_MISMATCH,
                `run ${runDate} belongs to a different principal and cannot be replayed to ${principal}`,
                { runDate, principal },
              );
            }
            // Reconcile a missing terminal audit row (fix round 1,
            // TBP6-002): a crash between the run-row commit and the
            // RUN_COMPLETED insert must not leave zero terminal
            // evidence forever.
            const { rows: termRows } = await tx.query(
              "SELECT 1 FROM tb_consolidation_audit WHERE run_date = $1 AND entry_type = 'RUN_COMPLETED' LIMIT 1",
              [runDate],
            );
            if (!termRows.length) {
              await audit(tx, runDate, "RUN_COMPLETED", { receiptId: stored.receiptId, counts: stored.counts }, now);
            }
            return { ...stored, replayed: true };
          }
          if (existing.rows.length && existing.rows[0].state === "MISSED") {
            fail(
              P6_CODES.SLOT_MISSED,
              `run ${runDate} was recorded MISSED; missed slots are terminal and never backfilled`,
              { runDate },
            );
          }

          let binding;
          let missedDates = [];
          let outageBaseline = null;
          const isResume = existing.rows.length && existing.rows[0].state === "INCOMPLETE";
          if (isResume) {
            binding = await readBinding(tx, runDate);
            if (!binding) {
              fail(
                P6_CODES.RUN_BINDING_MISMATCH,
                `INCOMPLETE run ${runDate} has no stored binding and cannot resume`,
                { runDate },
              );
            }
            if (binding.principal !== principal) {
              fail(
                P6_CODES.PRINCIPAL_MISMATCH,
                `INCOMPLETE run ${runDate} belongs to a different principal and cannot resume as ${principal}`,
                { runDate, principal },
              );
            }
            if (
              binding.settings.limit !== limit ||
              stableStringify(binding.settings.budgets) !== stableStringify(budgets)
            ) {
              fail(
                P6_CODES.RUN_BINDING_MISMATCH,
                `resume settings for ${runDate} differ from the bound run context`,
                { runDate },
              );
            }
            binding.leaseGeneration = leaseGeneration;
            missedDates = binding.progress.missedDates ?? [];
            outageBaseline = binding.progress.outageBaseline ?? null;
          } else {
            // A binding with no run row means a crashed attempt:
            // resume it instead of overwriting it (fix round 1,
            // TBP6-002). Like an INCOMPLETE resume, this is a bound
            // continuation, not a fresh historical execution, so
            // the same-day gate does not apply; the missed walk
            // already ran in the crashed attempt and is skipped.
            const priorBinding = await readBinding(tx, runDate);
            if (priorBinding) {
              if (priorBinding.principal !== principal) {
                fail(
                  P6_CODES.PRINCIPAL_MISMATCH,
                  `crashed run ${runDate} belongs to a different principal and cannot resume as ${principal}`,
                  { runDate, principal },
                );
              }
              if (
                priorBinding.settings.limit !== limit ||
                stableStringify(priorBinding.settings.budgets) !== stableStringify(budgets)
              ) {
                fail(
                  P6_CODES.RUN_BINDING_MISMATCH,
                  `resume settings for ${runDate} differ from the bound run context`,
                  { runDate },
                );
              }
              binding = priorBinding;
              binding.leaseGeneration = leaseGeneration;
              missedDates = binding.progress.missedDates ?? [];
              outageBaseline = binding.progress.outageBaseline ?? null;
            } else {
              // Fresh execution only on its own Chicago civil date.
              if (civilDateInChicago(now) !== runDate) {
                fail(
                  P6_CODES.SLOT_EXPIRED,
                  `run ${runDate} is not the current civil date (now is ${civilDateInChicago(now)} in America/Chicago); historical dates are never executed ad hoc`,
                  { runDate, currentCivilDate: civilDateInChicago(now) },
                );
              }
              const marked = await markMissed(tx, { runDate, now });
              missedDates = marked.missed;
              outageBaseline = marked.outageBaseline;
              const revision = await latestRevisionOn(tx);
              binding = {
                runDate,
                principal,
                slotInstant,
                settings: { limit, budgets },
                progress: {
                  step: "BOUND",
                  snapshotRevision: revision,
                  missedDates,
                  outageBaseline,
                },
                leaseGeneration,
                createdAt: now,
                updatedAt: now,
              };
              await writeBinding(tx, binding);
              await audit(tx, runDate, "RUN_STARTED", { runDate, slotInstant, leaseGeneration }, now);
            }
          }

          const ctx = {
            tx,
            runDate,
            principal,
            slotInstant,
            now,
            budgets,
            clock,
            startClock: clock(),
            charge: { objects: 0, bytes: 0 },
            currentStep: "BOUND",
            settings: binding.settings,
            progress: binding.progress,
            snapshotRevision: binding.progress.snapshotRevision,
            saveProgress: async () => {
              binding.progress.updatedAt = now;
              binding.leaseGeneration = leaseGeneration;
              await writeBinding(tx, binding);
            },
          };
          // The ctx.progress object IS binding.progress: steps mutate
          // it and saveProgress persists the whole binding. Keep the
          // alias in sync after any step replaces it (none do).
          try {
            const snapshot = await stepSnapshot(ctx);
            const { picked, selection } = await stepSelection(ctx, snapshot);
            const verification = await stepVerification(ctx, snapshot, picked);
            const proposals = await stepProposals(ctx, snapshot, verification);
            const apply = await stepApply(ctx, snapshot, verification);

            const counts = {
              considered: selection.total,
              promoted: verification.promoted.length,
              skipped: verification.skipped.length,
              duplicates: verification.duplicates.length,
              similarities: verification.similarities.length,
              conflicts: verification.conflicts.length,
              proposalsFiled: proposals.filed.length,
              factsPromoted: apply.factIds.length,
              factsArchived: apply.archivedFactIds.length,
              factsSuperseded: apply.supersededFactIds.length,
              missedDates,
              outageBaseline,
            };
            const receiptBody = {
              runDate,
              slotInstant,
              principal,
              budgetsVersion: budgets.version,
              role: dbRole,
              leaseGeneration,
              snapshot,
              selection,
              verification,
              proposals,
              apply,
              counts,
              checkpoints: [...CHECKPOINTS],
            };
            const receiptId = sha32(stableStringify(receiptBody));
            const receipt = { receiptId, ...receiptBody };
            // Write-boundary enforcement (fix round 1, TBP6-002):
            // the lease must still be ours, and the connection must
            // still be the consolidator role, before finalizing.
            const { rows: leaseRows } = await tx.query(
              "SELECT holder, run_date FROM tb_consolidation_lease WHERE id = 1",
            );
            if (!leaseRows.length || leaseRows[0].holder !== holder || leaseRows[0].run_date !== runDate) {
              fail(P6_CODES.LEASE_HELD, `lease lost before finalize for ${runDate}`, { runDate, holder });
            }
            const finalRole = await currentDbRole(tx);
            if (finalRole !== consolidatorRole) {
              fail(P6_CODES.ROLE_DENIED, `apply requires database role ${consolidatorRole}, got ${finalRole}`, {
                role: finalRole,
              });
            }
            // Terminal pair commits together: run row + RUN_COMPLETED
            // audit in one explicit transaction, so a crash between
            // them cannot leave a COMPLETED row with zero terminal
            // evidence.
            await tx.query("BEGIN");
            try {
              await tx.query(
                `INSERT INTO tb_consolidation_runs
                   (run_date, slot_instant, state, lease_generation, source_revision, source_watermark,
                    episodes_considered, episodes_promoted, duplicates_found, conflicts_found,
                    proposals_filed, receipt, started_at, completed_at)
                 VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
                 ON CONFLICT (run_date) DO UPDATE SET
                   state = 'COMPLETED', lease_generation = EXCLUDED.lease_generation,
                   source_revision = EXCLUDED.source_revision,
                   source_watermark = EXCLUDED.source_watermark,
                   episodes_considered = EXCLUDED.episodes_considered,
                   episodes_promoted = EXCLUDED.episodes_promoted,
                   duplicates_found = EXCLUDED.duplicates_found,
                   conflicts_found = EXCLUDED.conflicts_found,
                   proposals_filed = EXCLUDED.proposals_filed,
                   receipt = EXCLUDED.receipt, completed_at = EXCLUDED.completed_at`,
                [
                  runDate,
                  slotInstant,
                  leaseGeneration,
                  snapshot.revision,
                  snapshot.watermark,
                  selection.total,
                  verification.promoted.length,
                  verification.duplicates.length,
                  verification.conflicts.length,
                  proposals.filed.length,
                  stableStringify(receipt),
                  now,
                ],
              );
              await audit(tx, runDate, "RUN_COMPLETED", { receiptId, counts }, now);
              await tx.query("COMMIT");
            } catch (e) {
              await tx.query("ROLLBACK").catch(() => undefined);
              throw e;
            }
            await audit(tx, runDate, "EXPORT", { receiptId, counts }, now);
            await writeCheckpoint(tx, runDate, "EXPORT", counts, now);
            ctx.progress.step = "DONE";
            await ctx.saveProgress();
            return { ...receipt, replayed: false };
          } catch (e) {
            if (!(e instanceof BudgetStop)) throw e;
            // Budget-bounded stop: persist the INCOMPLETE state with
            // its stable continuation (binding progress already
            // holds step + cursors). No COMPLETED receipt, no dropped
            // remainder: a later attempt resumes from the binding.
            await tx.query(
              `INSERT INTO tb_consolidation_runs
                 (run_date, slot_instant, state, lease_generation, started_at, completed_at)
               VALUES ($1, $2, 'INCOMPLETE', $3, $4, NULL)
               ON CONFLICT (run_date) DO UPDATE SET
                 state = 'INCOMPLETE', lease_generation = EXCLUDED.lease_generation,
                 started_at = EXCLUDED.started_at, completed_at = NULL`,
              [runDate, slotInstant, leaseGeneration, now],
            );
            const stopCounts = { step: e.step, reason: e.reason, charged: { ...ctx.charge } };
            await writeIncompleteCheckpoint(tx, runDate, stopCounts, now);
            await audit(tx, runDate, "RUN_INCOMPLETE", stopCounts, now);
            return {
              incomplete: true,
              runDate,
              step: e.step,
              reason: e.reason,
              charged: { ...ctx.charge },
            };
          }
        });
      });
    } finally {
      // Release only our own lease. A crashed process never reaches
      // this line — its lease stands for explicit recovery.
      await db.query(
        "UPDATE tb_consolidation_lease SET holder = NULL, run_date = NULL, acquired_at = NULL WHERE id = 1 AND holder = $1 AND run_date = $2",
        [holder, runDate],
      ).catch(() => undefined);
    }
  }

  // A stored receipt belongs to its run principal (fix round 1,
  // TBP6-001). The principal argument is required: there is no
  // implicit reader context.
  async function getRunReceipt(runDate, { principal } = {}) {
    assertCivilDate(runDate);
    assertNonEmptyString(principal, "principal");
    const { rows } = await db.query(
      "SELECT receipt FROM tb_consolidation_runs WHERE run_date = $1 AND state = 'COMPLETED'",
      [runDate],
    );
    if (!rows.length || !rows[0].receipt) {
      fail(P6_CODES.UNKNOWN_RUN, `no completed run for ${runDate}`, { runDate });
    }
    const receipt = JSON.parse(rows[0].receipt);
    if (receipt.principal !== principal) {
      fail(
        P6_CODES.PRINCIPAL_MISMATCH,
        `run ${runDate} belongs to a different principal and cannot be read by ${principal}`,
        { runDate, principal },
      );
    }
    return receipt;
  }

  // Audit export, principal-bound like receipts (fix round 1,
  // TBP6-001). MISSED rows carry no episode data (only slot
  // instants), so any provided principal may read them; COMPLETED
  // and INCOMPLETE rows are bound to their run principal.
  async function exportAudit(runDate, { principal } = {}) {
    assertCivilDate(runDate);
    assertNonEmptyString(principal, "principal");
    const { rows: runRows } = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = $1",
      [runDate],
    );
    if (!runRows.length) {
      fail(P6_CODES.UNKNOWN_RUN, `no run ledger row for ${runDate}`, { runDate });
    }
    if (runRows[0].state !== "MISSED") {
      const binding = await readBinding(db, runDate);
      const { rows: receiptRows } = await db.query(
        "SELECT receipt FROM tb_consolidation_runs WHERE run_date = $1 AND state = 'COMPLETED'",
        [runDate],
      );
      const expectedPrincipal =
        binding?.principal ??
        (receiptRows.length && receiptRows[0].receipt ? JSON.parse(receiptRows[0].receipt).principal : null);
      if (expectedPrincipal !== null && expectedPrincipal !== principal) {
        fail(
          P6_CODES.PRINCIPAL_MISMATCH,
          `run ${runDate} belongs to a different principal and cannot be exported by ${principal}`,
          { runDate, principal },
        );
      }
    }
    const { rows } = await db.query(
      "SELECT seq, entry_type, payload, recorded_at FROM tb_consolidation_audit WHERE run_date = $1 ORDER BY seq ASC",
      [runDate],
    );
    return {
      runDate,
      state: runRows[0].state,
      entries: rows.map((r) => ({
        seq: Number(r.seq),
        entryType: r.entry_type,
        payload: JSON.parse(r.payload),
        recordedAt: r.recorded_at,
      })),
    };
  }

  return {
    migrateP6,
    runConsolidation,
    getRunReceipt,
    exportAudit,
    fileExplicitProposal,
    // Test seams (not part of the run contract): step functions are
    // reachable only through runConsolidation in production use.
    _slotInstantForCivilDate: slotInstantForCivilDate,
    _civilDateInChicago: civilDateInChicago,
  };
}

export { CODES, P6_CODES };
