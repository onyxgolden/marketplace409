// Team Brain P6 — consolidation / replay engine.
//
// Ordered steps (GS-P6; parent contract §4 limits + §6 70/30 mix):
//   1. Snapshot source watermark
//   2. Bounded deterministic recent/older replay selection
//   3. Source/grant verification and typed duplicate/conflict detection
//   4. Closed-schema proposed actions
//   5. Guarded permitted apply through tb_consolidator
//   6. Fenced checkpoints, counts/receipts, audit export
//
// Promote only verified uncontested typed event facts. Conflicts,
// standing rules, and permission changes remain proposals for Jason,
// never auto-applied. Episode text is evidence, never authority.
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
//   - Least privilege: only role tb_consolidator may apply. Any
//     other role fails fast with ROLE_DENIED before any write, and
//     the apply step re-checks the role before writing a fact row.

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

function normalizeDuplicateKey(title, body) {
  const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return `${norm(title)}\n${norm(body)}`;
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

export function createConsolidationEngine(db) {
  assertQueryHandle(db);

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

  // Authorization filter shared by snapshot, selection, and conflict
  // counterparts: public, or granted to the run principal. Forbidden
  // scopes are excluded even on direct inserts. Denied episodes are
  // invisible to counts, fingerprints, and diagnostics alike.
  function authWhere(principalIndex) {
    return `e.scope NOT IN ('tenant', 'ledger', 'financial', 'enrollment', 'scheduling')
      AND (e.visibility = 'public' OR EXISTS (
        SELECT 1 FROM tb_episode_grants g
        WHERE g.episode_id = e.episode_id AND g.principal = $${principalIndex}
      ))`;
  }

  // Step 1 — snapshot. The run's source watermark is a deterministic
  // fingerprint over the authorized episodes at the snapshot revision
  // (episode id + episode revision + source watermark, sorted), plus
  // the authorized count. Same store + same principal always yields
  // the same fingerprint; denied episodes contribute nothing.
  async function stepSnapshot(tx, { runDate, principal, now }) {
    const revision = await latestRevisionOn(tx);
    const { rows } = await tx.query(
      `SELECT e.episode_id, e.revision, e.source_watermark FROM tb_episodes e
       WHERE e.revision <= $1 AND ${authWhere(2)}
       ORDER BY e.episode_id ASC`,
      [revision, principal],
    );
    const fingerprint = sha32(
      stableStringify(
        rows.map((r) => [r.episode_id, Number(r.revision), r.source_watermark]),
      ),
    );
    const snapshot = {
      revision,
      watermark: fingerprint,
      episodeCount: rows.length,
    };
    await audit(tx, runDate, "SNAPSHOT", snapshot, now);
    await writeCheckpoint(tx, runDate, "SNAPSHOT", snapshot, now);
    return snapshot;
  }

  // Step 2 — bounded deterministic selection, 70/30 recent/older mix
  // (parent contract §6 starting setting). Recent = captured within
  // 30 days before the slot instant; older = before that. Each side
  // orders captured_at_ms DESC, episode_id ASC; the merged selection
  // keeps that order. A short side is filled from the other side;
  // the total never exceeds the limit. ARCHIVED-at-snapshot
  // episodes are excluded here; their previously promoted facts are
  // handled by the apply step's reverify, not by re-selection.
  async function stepSelection(tx, { runDate, principal, snapshot, slotInstant, limit, now }) {
    const slotMs = Date.parse(slotInstant);
    const recentCutoff = slotMs - RECENT_WINDOW_DAYS * 86400 * 1000;
    const recentTarget = Math.floor(limit * 0.7);
    const olderTarget = limit - recentTarget;
    const baseWhere = `e.revision <= $1 AND ${authWhere(2)}`;
    const activeWhere = `${baseWhere} AND NOT (e.state = 'ARCHIVED' OR EXISTS (
      SELECT 1 FROM tb_episode_events ev
      WHERE ev.episode_id = e.episode_id AND ev.event_type = 'ARCHIVED'
      AND ev.revision <= $1
    ))`;
    const order = "ORDER BY e.captured_at_ms DESC, e.episode_id ASC";
    const cols = `e.episode_id, e.scope, e.title, e.body, e.source_repo, e.source_path,
      e.source_commit, e.source_blob, e.source_watermark, e.captured_at,
      e.captured_at_ms, e.revision, e.state, e.visibility,
      e.provenance_status, e.conflict_group`;
    const recent = await tx.query(
      `SELECT ${cols} FROM tb_episodes e
       WHERE ${activeWhere} AND e.captured_at_ms >= $3 ${order} LIMIT $4`,
      [snapshot.revision, principal, recentCutoff, recentTarget],
    );
    const older = await tx.query(
      `SELECT ${cols} FROM tb_episodes e
       WHERE ${activeWhere} AND e.captured_at_ms < $3 ${order} LIMIT $4`,
      [snapshot.revision, principal, recentCutoff, olderTarget],
    );
    let picked = [...recent.rows, ...older.rows];
    // Fill a short side from the other side, still bounded by limit.
    if (picked.length < limit) {
      const pickedIds = new Set(picked.map((r) => r.episode_id));
      const extra = await tx.query(
        `SELECT ${cols} FROM tb_episodes e
         WHERE ${activeWhere} ${order} LIMIT $3`,
        [snapshot.revision, principal, limit],
      );
      for (const row of extra.rows) {
        if (picked.length >= limit) break;
        if (!pickedIds.has(row.episode_id)) picked.push(row);
      }
    }
    picked.sort((a, b) =>
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
    await audit(tx, runDate, "SELECTION", selection, now);
    await writeCheckpoint(tx, runDate, "SELECTION", selection, now);
    return { picked, selection };
  }

  // Step 3 — verification + typed detection. An episode promotes
  // only when it passes every gate: complete provenance, no
  // multi-member authorized conflict group, not a later duplicate.
  // Duplicates normalize title+body (trim, collapse whitespace,
  // lowercase); the first episode in selection order is canonical.
  async function stepVerification(tx, { runDate, principal, snapshot, picked, now }) {
    const skipped = [];
    const conflicts = [];
    const duplicates = [];
    const promoted = [];
    const seenDuplicateKeys = new Map();

    // Conflict groups among the selection, with authorized
    // counterparts at the snapshot revision (denied counterparts
    // contribute nothing — same boundary as P5 conflict metadata).
    const groups = [...new Set(picked.map((r) => r.conflict_group).filter(Boolean))];
    const groupMembers = new Map();
    if (groups.length) {
      const { rows } = await tx.query(
        `SELECT conflict_group, episode_id FROM tb_episodes e
         WHERE e.conflict_group = ANY($1) AND e.revision <= $2
         AND ${authWhere(3)}
         ORDER BY episode_id ASC`,
        [groups, snapshot.revision, principal],
      );
      for (const row of rows) {
        if (!groupMembers.has(row.conflict_group)) groupMembers.set(row.conflict_group, []);
        groupMembers.get(row.conflict_group).push(row.episode_id);
      }
    }
    const conflictedIds = new Set();
    for (const [group, members] of groupMembers) {
      if (members.length > 1) {
        conflicts.push({ group, members: [...members] });
        for (const id of members) conflictedIds.add(id);
      }
    }

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
      const key = normalizeDuplicateKey(row.title, row.body);
      if (seenDuplicateKeys.has(key)) {
        const canonical = seenDuplicateKeys.get(key);
        let entry = duplicates.find((d) => d.key === key);
        if (!entry) {
          entry = { key, canonical, duplicates: [] };
          duplicates.push(entry);
        }
        entry.duplicates.push(episodeId);
        skipped.push({ episodeId, reason: "DUPLICATE_OF_CANONICAL" });
        continue;
      }
      seenDuplicateKeys.set(key, episodeId);
      promoted.push({
        episodeId,
        scope: row.scope,
        conflictGroup: row.conflict_group,
        isDuplicateCanonical: duplicates.some((d) => d.canonical === episodeId),
      });
    }
    // A canonical that later gained duplicates still counts as
    // canonical: recompute after the full pass.
    const canonicalIds = new Set(duplicates.map((d) => d.canonical));
    for (const p of promoted) p.isDuplicateCanonical = canonicalIds.has(p.episodeId);

    const verification = {
      promoted: promoted.map((p) => p.episodeId),
      skipped,
      conflicts,
      duplicates,
    };
    await audit(tx, runDate, "VERIFICATION", verification, now);
    await writeCheckpoint(tx, runDate, "VERIFICATION", verification, now);
    return { promoted, verification };
  }

  // Step 4 — closed-schema proposed actions, persisted. CONFLICT
  // proposals carry the authorized member list; DUPLICATE proposals
  // carry canonical + duplicates. Re-filing an identical proposal
  // replays (ON CONFLICT DO NOTHING). Proposals are OPEN until
  // Jason closes them; the engine never closes one.
  async function stepProposals(tx, { runDate, snapshot, verification, now }) {
    const filed = [];
    for (const conflict of verification.conflicts) {
      const id = proposalIdFor("CONFLICT", `${conflict.group}:${[...conflict.members].sort().join(",")}`);
      const detail = {
        type: "CONFLICT",
        group: conflict.group,
        members: [...conflict.members].sort(),
        snapshotRevision: snapshot.revision,
      };
      await tx.query(
        `INSERT INTO tb_consolidation_proposals
           (proposal_id, proposal_type, episode_id, conflict_group, detail, authorization_id, status, filed_run_date, filed_at)
         VALUES ($1, 'CONFLICT', NULL, $2, $3, NULL, 'OPEN', $4, $5)
         ON CONFLICT (proposal_id) DO NOTHING`,
        [id, conflict.group, stableStringify(detail), runDate, now],
      );
      filed.push(id);
    }
    for (const dup of verification.duplicates) {
      const id = proposalIdFor("DUPLICATE", `${dup.key}:${dup.canonical}:${[...dup.duplicates].sort().join(",")}`);
      const detail = {
        type: "DUPLICATE",
        canonical: dup.canonical,
        duplicates: [...dup.duplicates].sort(),
        snapshotRevision: snapshot.revision,
      };
      await tx.query(
        `INSERT INTO tb_consolidation_proposals
           (proposal_id, proposal_type, episode_id, conflict_group, detail, authorization_id, status, filed_run_date, filed_at)
         VALUES ($1, 'DUPLICATE', $2, NULL, $3, NULL, 'OPEN', $4, $5)
         ON CONFLICT (proposal_id) DO NOTHING`,
        [id, dup.canonical, stableStringify(detail), runDate, now],
      );
      filed.push(id);
    }
    const proposals = { filed };
    await audit(tx, runDate, "PROPOSALS", proposals, now);
    await writeCheckpoint(tx, runDate, "PROPOSALS", proposals, now);
    return proposals;
  }

  // Step 5 — guarded apply. Role is re-checked here even though
  // runConsolidation checks it up front: no fact row is ever written
  // by a non-consolidator, through any path. Promoted facts are
  // inserted idempotently; facts whose source episode is now
  // ARCHIVED at the snapshot are archived-without-delete (state flag
  // + note only, never a DELETE).
  async function stepApply(tx, { runDate, role, snapshot, promoted, now }) {
    if (role !== CONSOLIDATOR_ROLE) {
      fail(P6_CODES.ROLE_DENIED, `apply requires role ${CONSOLIDATOR_ROLE}, got ${role}`, { role });
    }
    const factIds = [];
    for (const p of promoted) {
      // Every promoted episode is uncontested in the authorized
      // view (multi-member groups were skipped at verification), so
      // every promoted episode earns CONFLICT_FREE. A canonical of a
      // duplicate set additionally earns DUPLICATE_CANONICAL.
      const types = ["EPISODE_RECORDED", "SOURCE_VERIFIED", "SCOPE_CLASSIFIED", "CONFLICT_FREE"];
      if (p.isDuplicateCanonical) types.push("DUPLICATE_CANONICAL");
      for (const factType of types) {
        const factId = factIdFor(p.episodeId, factType);
        const value = stableStringify({
          episodeId: p.episodeId,
          scope: p.scope,
          factType,
          snapshotRevision: snapshot.revision,
        });
        await tx.query(
          `INSERT INTO tb_consolidated_facts
             (fact_id, episode_id, fact_type, fact_key, fact_value, promoted_revision, promoted_run_date, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
           ON CONFLICT (fact_id) DO NOTHING`,
          [factId, p.episodeId, factType, p.episodeId, value, snapshot.revision, runDate],
        );
        factIds.push(factId);
      }
    }
    // Reverify: archive facts whose source episode is ARCHIVED at
    // the snapshot. State flag + note only — never a DELETE.
    const archivedFactIds = [];
    const { rows: liveFacts } = await tx.query(
      "SELECT fact_id, episode_id FROM tb_consolidated_facts WHERE state = 'ACTIVE'",
    );
    if (liveFacts.length) {
      const archived = await archivedIdsAt(
        tx,
        liveFacts.map((r) => r.episode_id),
        snapshot.revision,
      );
      for (const row of liveFacts) {
        if (archived.has(row.episode_id)) {
          await tx.query(
            `UPDATE tb_consolidated_facts
             SET state = 'ARCHIVED', archived_note = $2, archived_actor = $3, archived_at = $4
             WHERE fact_id = $1 AND state = 'ACTIVE'`,
            [row.fact_id, "Source episode archived at consolidation snapshot.", "tb_consolidator", now],
          );
          archivedFactIds.push(row.fact_id);
        }
      }
    }
    const apply = { factIds, archivedFactIds };
    await audit(tx, runDate, "APPLY", apply, now);
    await writeCheckpoint(tx, runDate, "APPLY", apply, now);
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

  // Full run for one civil date. Order of gates (all before any
  // write): input validation, role, slot due. Then the atomic lease
  // acquire (the two-worker arbiter), then the locked step sequence.
  // A COMPLETED run replays its stored receipt without re-running.
  // A crashed holder's lease is recovered only with recover:true and
  // the same holder id; otherwise LEASE_HELD.
  async function runConsolidation({
    runDate,
    principal = "consolidator",
    role = CONSOLIDATOR_ROLE,
    limit = DEFAULT_SELECTION_LIMIT,
    now = new Date().toISOString(),
    holder = `consolidator-${runDate}`,
    recover = false,
  } = {}) {
    assertCivilDate(runDate);
    assertNonEmptyString(principal, "principal");
    assertNonEmptyString(role, "role");
    if (!Number.isInteger(limit) || limit < 1) {
      fail(CODES.INVALID_FIELD, "limit must be a positive integer", { limit });
    }
    // Fail fast, zero writes: a lesser role gets the typed denial
    // and no persisted effect of any kind.
    if (role !== CONSOLIDATOR_ROLE) {
      fail(P6_CODES.ROLE_DENIED, `consolidation requires role ${CONSOLIDATOR_ROLE}, got ${role}`, { role });
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
          // A COMPLETED run replays its stored receipt: no re-apply,
          // no duplicate facts, no second receipt.
          const existing = await tx.query(
            "SELECT state, receipt FROM tb_consolidation_runs WHERE run_date = $1",
            [runDate],
          );
          if (existing.rows.length && existing.rows[0].state === "COMPLETED") {
            return { ...JSON.parse(existing.rows[0].receipt), replayed: true };
          }

          // Mark earlier passed slots with no ledger row as MISSED
          // (audit-only; a missed slot is never backfilled). Walk
          // back from the day before and stop at the first row
          // found — earlier days were already settled by that run.
          // If no row exists within the lookback, this is the first
          // run establishing a baseline: mark nothing. Cap the
          // lookback so one run cannot rewrite history.
          const missed = [];
          {
            const candidates = [];
            const cursor = new Date(`${runDate}T00:00:00Z`);
            let foundRow = false;
            for (let i = 0; i < MISSED_LOOKBACK_DAYS; i += 1) {
              cursor.setUTCDate(cursor.getUTCDate() - 1);
              const day = cursor.toISOString().slice(0, 10);
              const { rows } = await tx.query(
                "SELECT 1 FROM tb_consolidation_runs WHERE run_date = $1",
                [day],
              );
              if (rows.length) {
                foundRow = true;
                break;
              }
              const daySlot = slotInstantForCivilDate(day);
              if (Date.parse(now) >= Date.parse(daySlot)) candidates.push(day);
            }
            if (foundRow) {
              for (const day of candidates) {
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
              }
            }
          }

          await audit(tx, runDate, "RUN_STARTED", { runDate, slotInstant, leaseGeneration }, now);
          // Restart resume: steps always recompute from the store,
          // and every write inside them is ON CONFLICT DO NOTHING
          // (facts, proposals, checkpoints, audit rows), so a
          // resumed run writes nothing new for completed work. The
          // checkpoint rows fence the steps (each is written before
          // the next starts) and record what a crashed run reached.
          const snapshot = await stepSnapshot(tx, { runDate, principal, now });
          const { picked, selection } = await stepSelection(tx, {
            runDate,
            principal,
            snapshot,
            slotInstant,
            limit,
            now,
          });
          const { promoted, verification } = await stepVerification(tx, {
            runDate,
            principal,
            snapshot,
            picked,
            now,
          });
          const proposals = await stepProposals(tx, { runDate, snapshot, verification, now });
          const apply = await stepApply(tx, { runDate, role, snapshot, promoted, now });

          const counts = {
            considered: selection.total,
            promoted: verification.promoted.length,
            skipped: verification.skipped.length,
            duplicates: verification.duplicates.length,
            conflicts: verification.conflicts.length,
            proposalsFiled: proposals.filed.length,
            factsPromoted: apply.factIds.length,
            factsArchived: apply.archivedFactIds.length,
            missedDates: missed,
          };
          const receiptBody = {
            runDate,
            slotInstant,
            role,
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
          await audit(tx, runDate, "EXPORT", { receiptId, counts }, now);
          await writeCheckpoint(tx, runDate, "EXPORT", counts, now);
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
          return { ...receipt, replayed: false };
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

  async function getRunReceipt(runDate) {
    assertCivilDate(runDate);
    const { rows } = await db.query(
      "SELECT receipt FROM tb_consolidation_runs WHERE run_date = $1 AND state = 'COMPLETED'",
      [runDate],
    );
    if (!rows.length || !rows[0].receipt) {
      fail(P6_CODES.UNKNOWN_RUN, `no completed run for ${runDate}`, { runDate });
    }
    return JSON.parse(rows[0].receipt);
  }

  async function exportAudit(runDate) {
    assertCivilDate(runDate);
    const { rows: runRows } = await db.query(
      "SELECT state FROM tb_consolidation_runs WHERE run_date = $1",
      [runDate],
    );
    if (!runRows.length) {
      fail(P6_CODES.UNKNOWN_RUN, `no run ledger row for ${runDate}`, { runDate });
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
