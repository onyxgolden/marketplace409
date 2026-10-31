// Team Brain P5 — immutable episode capture + deterministic retrieval.
//
// search_memory(query, scope, as_of) over PostgreSQL full-text search,
// exact-ID lookup, and scope retrieval. Offline test target: PGlite
// (real PostgreSQL semantics, in-memory). The adapter takes any db
// handle with async query(sql, params) -> { rows } (PGlite or pg).
//
// Ordering guarantees (enforced here, not in documentation):
//   1. Authorization and source visibility run BEFORE ranking and
//      limiting. The search query filters grants, visibility, scope,
//      forbidden domains, and the as_of revision in SQL; ranking and
//      the 20-result cap apply only to the authorized set. Denied
//      content therefore cannot leak through snippets, result counts,
//      or diagnostic metadata — including conflict metadata (fix
//      round 1, TBP5-001): conflict counterparts pass the same
//      authorization/source-visibility, allowed-domain, scope, and
//      revision boundary as retrieval.
//   2. Deterministic ranking. Score DESC, captured_at_ms DESC,
//      episode_id ASC. Episode ids are unique, so the tie-break chain
//      is total: the same store + query always yields byte-identical
//      results.
//   3. Immutability. Episodes are never updated or deleted by this
//      adapter. A replayed capture (same deterministic id) is a no-op
//      that does not bump the revision. Archive appends an explicit
//      archive event with its own revision and full audit identity;
//      the episode row itself never changes, so a query at an earlier
//      pin still projects the original state (fix round 1, TBP5-003).
//      Fix round 2 (TBP5-009): an archive replay compares the stored
//      full audit identity — actor, note, claimed operation id, and
//      claimed timestamp — and any difference fails with a named
//      conflicting-replay result instead of reusing the receipt.
//      Capturing with state ARCHIVED is a separately authorized import
//      path only: it requires an archiveAudit carrying the same full
//      identity, written as the episode's archive event in the same
//      transaction; without it the capture is refused.
//   4. In-process only (001A boundary). Every adapter operation on one
//      connection runs serialized through a connection-scoped promise
//      chain shared by every repository instance on that connection,
//      so concurrent captures in one process cannot interleave inside
//      one transaction (fix round 1, TBP5-002). Fix round 2 (TBP5-008):
//      serialization alone does not own a transaction on a pool —
//      each multi-statement transaction runs on one checked-out client
//      (pool-like handles) or on the dedicated single connection
//      (PGlite, checked-out pg.Client), so BEGIN, mutation, and COMMIT
//      always share one physical connection. A handle that cannot own
//      a transaction fails loudly with UNSUPPORTED_HANDLE instead of
//      silently claiming durability. No advisory lock, no fencing, no
//      cross-process safety is claimed: two processes capturing
//      concurrently may still interleave revisions. Do not deploy this
//      adapter behind two writers without a separately reviewed
//      fencing step (P6/P8 territory, Jason-gated).
//   5. Missing provenance is explicit. An episode captured without a
//      complete source identity carries provenanceStatus UNAVAILABLE;
//      retrieval withholds its snippet and body and marks the result
//      unavailable instead of presenting an unattributed hit.
//   6. Exclusion. Operational tenant, ledger/financial, enrollment,
//      and scheduling records are refused at capture (FORBIDDEN_DOMAIN)
//      and excluded from search even if inserted directly. Scope-based
//      exclusion is deliberate: a keyword scan would false-positive on
//      engineering text that merely mentions ledgers or schedules.
//   7. Revision boundary (fix round 1, TBP5-004). Pins and asOf values
//      are validated against the admitted high-water mark: a future
//      revision is refused, never silently clamped. Revision 0 (empty
//      store) and existing historical pins stay valid.
//   8. Working-set references (fix round 1, TBP5-005) are validated
//      before displacement — authorized episode, real episode version —
//      and revalidated on read; withheld references disclose no
//      forbidden identity, and a denied displacement preserves the
//      prior valid slot.
//   9. Capture identity (fix round 1, TBP5-006; set-normalized fix
//      round 2, TBP5-010) includes consequential persisted metadata —
//      visibility, grants as a true set (duplicates removed, then
//      sorted), provenanceStatus, state — so a capture that differs
//      in any of them is a new episode, never a silent replay of
//      different authority. Exact replays (identical metadata) still
//      replay.
//
// Hard gates (never in this slice): no DB role LOGIN/password
// provisioning, no authority registrations, no worker install or
// activation, no P8 cutover, no production migration, no spend.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODES, fail } from "../ledger/errors.mjs";
import {
  assertNonEmptyString,
  assertSourceBinding,
  assertUtcIso,
  utcIsoToMs,
} from "../ledger/validation.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import { P5_CODES } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MAX_RESULTS = 20;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_TITLE_CHARS = 500;
export const SNIPPET_CHARS = 500;

// Scopes whose records are excluded from this retrieval surface.
// Capture refuses them; search excludes them even on direct inserts.
export const FORBIDDEN_SCOPES = [
  "tenant",
  "ledger",
  "financial",
  "enrollment",
  "scheduling",
];

const EPISODE_FIELDS = [
  "scope",
  "title",
  "body",
  "source",
  "capturedAt",
  "visibility",
  "grants",
  "conflictGroup",
  "provenanceStatus",
  "state",
  "archiveAudit",
];

function rejectUnknownFields(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(CODES.INVALID_FIELD, `${what} has unknown field: ${key}`, {
        field: key,
      });
    }
  }
}

function assertScopeAllowed(scope) {
  if (FORBIDDEN_SCOPES.includes(scope)) {
    fail(P5_CODES.FORBIDDEN_DOMAIN, `scope is excluded from retrieval: ${scope}`, {
      scope,
    });
  }
}

// Deterministic episode identity: sha256 over the canonical capture.
// Same capture bytes always yield the same id, so replay is idempotent
// and a correction links as a new episode (new bytes, new id).
// Fix round 1 (TBP5-006): the canonical form includes the consequential
// persisted capture metadata — visibility, grants as a sorted set,
// provenanceStatus, state — each normalized to the capture defaults, so
// computeEpisodeId agrees with captureEpisode for bare and full inputs
// alike. A capture that differs in any of them is a different episode;
// it can never silently replay as different authority.
// Fix round 2 (TBP5-010): grants canonicalize as a true set —
// duplicates removed before sorting — so ["a","a"] and ["a"] share
// one episode id, matching the ON CONFLICT DO NOTHING grant storage.
export function computeEpisodeId(episode) {
  const canonical = stableStringify({
    scope: episode.scope,
    title: episode.title,
    body: episode.body,
    source: {
      repo: episode.source.repo,
      path: episode.source.path,
      commit: episode.source.commit ?? null,
      blob: episode.source.blob ?? null,
      watermark: episode.source.watermark,
    },
    capturedAt: episode.capturedAt,
    conflictGroup: episode.conflictGroup ?? null,
    visibility: episode.visibility ?? "public",
    grants: [...new Set(episode.grants ?? [])].sort(),
    provenanceStatus: episode.provenanceStatus ?? "COMPLETE",
    state: episode.state ?? "ACTIVE",
  });
  return `ep-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

// In-process serialization boundary (fix round 1, TBP5-002). One promise
// chain per db handle, shared by every repository instance created on
// that handle (WeakMap keyed by handle identity). Each operation runs
// to completion before the next starts, so no two operations on one
// connection can interleave inside one transaction. The chain never
// breaks: a failed operation still advances the tail, so a later
// operation is never starved by an earlier error. This is explicitly
// in-process only — it fences nothing across processes.
//
// Fix round 2 (TBP5-008): serialization by handle identity is NOT
// transaction ownership on a pool. A pg.Pool's per-call query routing
// may serve BEGIN, mutation, and COMMIT from different physical
// connections, so the transaction runner below (runTransaction) binds
// every multi-statement transaction to one checked-out client for
// pool-like handles, or to the dedicated single connection otherwise.
// The lock still wraps the whole checkout + transaction, so no two
// operations on one handle can interleave even across checkout.
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

// A pool-like handle exposes connect() plus pool bookkeeping counters
// (pg.Pool: totalCount/idleCount/waitingCount). A checked-out pg.Client
// also has connect(), but no pool counters — it IS a single connection
// and takes the dedicated-connection path. PGlite has neither.
function isPoolLikeHandle(dbHandle) {
  return (
    typeof dbHandle.connect === "function" &&
    (typeof dbHandle.totalCount === "number" ||
      typeof dbHandle.idleCount === "number" ||
      typeof dbHandle.waitingCount === "number")
  );
}

function assertTransactionHandle(dbHandle) {
  if (!dbHandle || typeof dbHandle.query !== "function") {
    fail(
      P5_CODES.UNSUPPORTED_HANDLE,
      "db handle must expose async query(sql, params)",
      {},
    );
  }
}

// Runs fn(tx) with tx bound to ONE physical connection for the whole
// multi-statement transaction. Pool-like handles check out a client
// (released in finally, even on failure); single-connection handles
// run on themselves. Transaction statements NEVER run on a pool-level
// query facade: for a pool, the pool handle's own query is never
// called here, so BEGIN/mutation/COMMIT cannot scatter across
// connections. A pool whose connect() yields no usable client fails
// loudly instead of silently claiming transactional durability.
async function runTransaction(dbHandle, fn) {
  if (!isPoolLikeHandle(dbHandle)) return fn(dbHandle);
  const client = await dbHandle.connect();
  if (
    !client ||
    typeof client.query !== "function" ||
    typeof client.release !== "function"
  ) {
    fail(
      P5_CODES.UNSUPPORTED_HANDLE,
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

// Archive audit identity (fix round 2, TBP5-009). note and actor are
// required and non-empty; operationId and timestamp are optional
// bindings. Unknown fields are rejected — a typo like { acotr } fails
// instead of silently discarding. The normalized form is what replay
// comparison uses: required fields always compare; optional bindings
// compare when the replay call claims them.
const ARCHIVE_AUDIT_FIELDS = ["note", "actor", "operationId", "timestamp"];
function validateArchiveAudit(audit, what) {
  if (audit === null || typeof audit !== "object" || Array.isArray(audit)) {
    fail(CODES.INVALID_FIELD, `${what} must be an object`, {});
  }
  rejectUnknownFields(audit, ARCHIVE_AUDIT_FIELDS, what);
  assertNonEmptyString(audit.note, `${what}.note`);
  assertNonEmptyString(audit.actor, `${what}.actor`);
  if (audit.operationId !== undefined && audit.operationId !== null) {
    assertNonEmptyString(audit.operationId, `${what}.operationId`);
  }
  if (audit.timestamp !== undefined && audit.timestamp !== null) {
    assertUtcIso(audit.timestamp, `${what}.timestamp`);
  }
  return {
    note: audit.note,
    actor: audit.actor,
    operationId: audit.operationId ?? null,
    timestamp: audit.timestamp ?? null,
  };
}

// Compares a claimed audit against a stored archive event row
// ({ note, actor, operation_id, created_at }). Any difference in a
// compared field fails with a named conflicting-replay result; the
// caller never reuses a receipt for a different audit claim.
function assertArchiveIdentityMatches(stored, claimed, what) {
  const mismatch =
    claimed.note !== stored.note ||
    claimed.actor !== stored.actor ||
    (claimed.operationId !== null && claimed.operationId !== stored.operation_id) ||
    (claimed.timestamp !== null && claimed.timestamp !== stored.created_at);
  if (mismatch) {
    fail(
      P5_CODES.ARCHIVE_REPLAY_CONFLICT,
      `${what} does not match the stored archive event`,
      {},
    );
  }
}

export function loadSchemaSql() {
  return readFileSync(join(HERE, "schema.sql"), "utf8");
}

export async function migrate(db) {
  if (!db || typeof db.exec !== "function") {
    fail(
      P5_CODES.UNSUPPORTED_HANDLE,
      "migrate requires a handle with exec(sql) (PGlite-style single connection)",
      {},
    );
  }
  await db.exec(loadSchemaSql());
}

export function createRetrievalRepository(db) {
  assertTransactionHandle(db);
  async function latestRevision() {
    const { rows } = await db.query(
      "SELECT revision FROM tb_retrieval_revisions WHERE id = 1",
    );
    return rows.length ? Number(rows[0].revision) : 0;
  }

  // Resolve the snapshot boundary for a search: a pin name, an asOf
  // revision, or the latest revision. Fix round 1 (TBP5-004): the
  // result is validated against the admitted high-water mark. A
  // future revision is refused with FUTURE_REVISION, never silently
  // clamped to latest — a historical pin must never become a promise
  // to accumulate future data, and dbRevision must never assert a
  // snapshot that does not exist. Revision 0 (empty store) stays
  // valid; pins created at or below the high-water mark stay valid.
  async function resolveRevision({ asOf = null, pin = null } = {}) {
    if (asOf !== null && pin !== null) {
      fail(CODES.INVALID_FIELD, "asOf and pin are mutually exclusive", {});
    }
    const latest = await latestRevision();
    if (pin !== null) {
      assertNonEmptyString(pin, "pin");
      const { rows } = await db.query(
        "SELECT revision FROM tb_pins WHERE pin_name = $1",
        [pin],
      );
      if (!rows.length) {
        fail(P5_CODES.UNKNOWN_PIN, `unknown pin: ${pin}`, { pin });
      }
      const pinned = Number(rows[0].revision);
      if (pinned > latest) {
        fail(P5_CODES.FUTURE_REVISION, `pin ${pin} points above the latest revision`, {
          pin,
          revision: pinned,
          latestRevision: latest,
        });
      }
      return pinned;
    }
    if (asOf !== null) {
      if (!Number.isInteger(asOf) || asOf < 0) {
        fail(CODES.INVALID_FIELD, "asOf must be a non-negative integer revision", {
          asOf,
        });
      }
      if (asOf > latest) {
        fail(P5_CODES.FUTURE_REVISION, `asOf ${asOf} is above the latest revision`, {
          asOf,
          latestRevision: latest,
        });
      }
      return asOf;
    }
    return latest;
  }

  // Capture one episode immutably. Returns { episodeId, revision, replayed }.
  // Replay (same deterministic id) returns the stored revision without
  // bumping the counter. Any failure inside the transaction rolls back
  // the revision bump, the episode row, and the grant rows together.
  async function captureEpisode(episode) {
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
      fail(CODES.INVALID_FIELD, "episode must be an object", {});
    }
    rejectUnknownFields(episode, EPISODE_FIELDS, "episode");
    assertNonEmptyString(episode.scope, "scope");
    assertScopeAllowed(episode.scope);
    assertNonEmptyString(episode.title, "title");
    if (episode.title.length > MAX_TITLE_CHARS) {
      fail(P5_CODES.EPISODE_OVERSIZED, "title exceeds 500 characters", {});
    }
    if (typeof episode.body !== "string" || episode.body === "") {
      fail(CODES.INVALID_FIELD, "body must be a non-empty string", {});
    }
    if (Buffer.byteLength(episode.body, "utf8") > MAX_BODY_BYTES) {
      fail(P5_CODES.EPISODE_OVERSIZED, "body exceeds 64 KiB", {});
    }
    // The shared validator reads present-null as invalid; for P5 a
    // null commit/blob means absent provenance (UNAVAILABLE below),
    // so validation runs on a copy with nulls omitted, and storage
    // normalizes them to SQL NULL.
    const sourceForValidation = { ...episode.source };
    if (sourceForValidation.commit == null) delete sourceForValidation.commit;
    if (sourceForValidation.blob == null) delete sourceForValidation.blob;
    assertSourceBinding(sourceForValidation);
    assertNonEmptyString(episode.source.watermark, "source.watermark");
    assertUtcIso(episode.capturedAt, "capturedAt");
    const visibility = episode.visibility ?? "public";
    if (!["public", "restricted"].includes(visibility)) {
      fail(CODES.INVALID_FIELD, "visibility must be public or restricted", {
        visibility,
      });
    }
    const provenanceStatus = episode.provenanceStatus ?? "COMPLETE";
    if (!["COMPLETE", "UNAVAILABLE"].includes(provenanceStatus)) {
      fail(CODES.INVALID_FIELD, "provenanceStatus must be COMPLETE or UNAVAILABLE", {
        provenanceStatus,
      });
    }
    if (
      provenanceStatus === "COMPLETE" &&
      (!episode.source.commit || !episode.source.blob)
    ) {
      fail(
        CODES.INCOMPLETE_PROVENANCE,
        "COMPLETE provenance requires source commit and blob",
        {},
      );
    }
    const state = episode.state ?? "ACTIVE";
    if (!["ACTIVE", "ARCHIVED"].includes(state)) {
      fail(CODES.INVALID_FIELD, "state must be ACTIVE or ARCHIVED", { state });
    }
    // Fix round 2 (TBP5-009): capturing with state ARCHIVED is a
    // separately authorized import path only. It requires an
    // archiveAudit carrying the same full audit identity an
    // archiveEpisode call would, written as the episode's archive
    // event in the same transaction — otherwise the capture would
    // bypass the event/audit contract. An archiveAudit on an ACTIVE
    // capture is meaningless and refused.
    let archiveAudit = null;
    if (state === "ARCHIVED") {
      if (episode.archiveAudit === undefined || episode.archiveAudit === null) {
        fail(
          P5_CODES.ARCHIVE_AUDIT_REQUIRED,
          "capture with state ARCHIVED requires archiveAudit with note and actor",
          {},
        );
      }
      archiveAudit = validateArchiveAudit(episode.archiveAudit, "archiveAudit");
    } else if (episode.archiveAudit !== undefined && episode.archiveAudit !== null) {
      fail(CODES.INVALID_FIELD, "archiveAudit is only valid with state ARCHIVED", {});
    }
    const grants = episode.grants ?? [];
    if (!Array.isArray(grants) || grants.some((g) => typeof g !== "string" || g === "")) {
      fail(CODES.INVALID_FIELD, "grants must be an array of non-empty strings", {});
    }
    if (episode.conflictGroup !== undefined && episode.conflictGroup !== null) {
      assertNonEmptyString(episode.conflictGroup, "conflictGroup");
    }

    const episodeId = computeEpisodeId(episode);
    const capturedAtMs = utcIsoToMs(episode.capturedAt, "capturedAt");
    // The whole read/check/write sequence runs on one transaction
    // owner (fix round 2, TBP5-008): for a pool-like handle the lookup
    // and the transaction share the checked-out client, so the
    // existence check cannot observe a different connection's state
    // than the insert lands on. For a single connection tx === db and
    // the behavior is unchanged. The replay early-return happens
    // before BEGIN, so no transaction is left open.
    return runTransaction(db, async (tx) => {
      const existing = await tx.query(
        "SELECT revision, state FROM tb_episodes WHERE episode_id = $1",
        [episodeId],
      );
      if (existing.rows.length) {
        // An ARCHIVED replay must present the same audit identity as
        // the stored import/archive event; a different claim fails
        // instead of silently reusing the receipt.
        if (existing.rows[0].state === "ARCHIVED") {
          const event = await tx.query(
            "SELECT note, actor, operation_id, created_at FROM tb_episode_events WHERE episode_id = $1 AND event_type = 'ARCHIVED'",
            [episodeId],
          );
          if (!event.rows.length) {
            fail(
              P5_CODES.ARCHIVE_REPLAY_CONFLICT,
              "archived episode has no archive event to replay against",
              { episodeId },
            );
          }
          assertArchiveIdentityMatches(event.rows[0], archiveAudit, "archiveAudit");
        }
        return {
          episodeId,
          revision: Number(existing.rows[0].revision),
          replayed: true,
        };
      }

      await tx.query("BEGIN");
      try {
        const bumped = await tx.query(
          "UPDATE tb_retrieval_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision",
        );
        const revision = Number(bumped.rows[0].revision);
        await tx.query(
          `INSERT INTO tb_episodes (
            episode_id, scope, title, body, source_repo, source_path,
            source_commit, source_blob, source_watermark, captured_at,
            captured_at_ms, revision, state, visibility, provenance_status,
            conflict_group
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            episodeId,
            episode.scope,
            episode.title,
            episode.body,
            episode.source.repo,
            episode.source.path,
            episode.source.commit ?? null,
            episode.source.blob ?? null,
            episode.source.watermark,
            episode.capturedAt,
            capturedAtMs,
            revision,
            state,
            visibility,
            provenanceStatus,
            episode.conflictGroup ?? null,
          ],
        );
        for (const principal of [...new Set(grants)]) {
          await tx.query(
            "INSERT INTO tb_episode_grants (episode_id, principal) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [episodeId, principal],
          );
        }
        if (state === "ARCHIVED") {
          await tx.query(
            `INSERT INTO tb_episode_events (episode_id, event_type, revision, note, actor, created_at, operation_id)
             VALUES ($1, 'ARCHIVED', $2, $3, $4, $5, $6)`,
            [
              episodeId,
              revision,
              archiveAudit.note,
              archiveAudit.actor,
              archiveAudit.timestamp ?? new Date().toISOString(),
              archiveAudit.operationId,
            ],
          );
        }
        await tx.query("COMMIT");
        return { episodeId, revision, replayed: false };
      } catch (err) {
        try {
          await tx.query("ROLLBACK");
        } catch {
          // Rollback failure must not mask the original error.
        }
        throw err;
      }
    });
  }

  async function grantEpisode(episodeId, principal) {
    assertNonEmptyString(episodeId, "episodeId");
    assertNonEmptyString(principal, "principal");
    const found = await db.query(
      "SELECT 1 FROM tb_episodes WHERE episode_id = $1",
      [episodeId],
    );
    if (!found.rows.length) {
      fail(P5_CODES.UNKNOWN_EPISODE, `unknown episode: ${episodeId}`, { episodeId });
    }
    await db.query(
      "INSERT INTO tb_episode_grants (episode_id, principal) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [episodeId, principal],
    );
    return { episodeId, principal };
  }

  // Archive appends an explicit archive event, it never rewrites the
  // episode row (fix round 1, TBP5-003). The event carries its own
  // revision (a fresh bump of the retrieval counter) plus full audit
  // identity. Fix round 2 (TBP5-009): note and actor are REQUIRED and
  // non-empty, unknown fields are rejected, and a replay compares the
  // stored full identity — an exact replay returns replayed:true with
  // no bump and no second event, while any changed actor, note,
  // claimed operation id, or claimed timestamp fails with a named
  // conflicting-replay result. Validation runs before the replay
  // return, so an omitted-audit or typo call can never reuse a
  // receipt. Episode existence is checked first, so archiving an
  // unknown episode still reports UNKNOWN_EPISODE.
  async function archiveEpisode(episodeId, audit = {}) {
    assertNonEmptyString(episodeId, "episodeId");
    const found = await db.query(
      "SELECT episode_id FROM tb_episodes WHERE episode_id = $1",
      [episodeId],
    );
    if (!found.rows.length) {
      fail(P5_CODES.UNKNOWN_EPISODE, `unknown episode: ${episodeId}`, { episodeId });
    }
    const claimed = validateArchiveAudit(audit, "audit");
    const prior = await db.query(
      "SELECT revision, note, actor, operation_id, created_at FROM tb_episode_events WHERE episode_id = $1 AND event_type = 'ARCHIVED'",
      [episodeId],
    );
    if (prior.rows.length) {
      assertArchiveIdentityMatches(prior.rows[0], claimed, "audit");
      return { episodeId, state: "ARCHIVED", revision: Number(prior.rows[0].revision), replayed: true };
    }
    return runTransaction(db, async (tx) => {
      await tx.query("BEGIN");
      try {
        const bumped = await tx.query(
          "UPDATE tb_retrieval_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision",
        );
        const revision = Number(bumped.rows[0].revision);
        await tx.query(
          `INSERT INTO tb_episode_events (episode_id, event_type, revision, note, actor, created_at, operation_id)
           VALUES ($1, 'ARCHIVED', $2, $3, $4, $5, $6)`,
          [
            episodeId,
            revision,
            claimed.note,
            claimed.actor,
            claimed.timestamp ?? new Date().toISOString(),
            claimed.operationId,
          ],
        );
        await tx.query("COMMIT");
        return { episodeId, state: "ARCHIVED", revision, replayed: false };
      } catch (err) {
        try {
          await tx.query("ROLLBACK");
        } catch {
          // Rollback failure must not mask the original error.
        }
        throw err;
      }
    });
  }

  async function pinRevision(pin, revision) {
    assertNonEmptyString(pin, "pin");
    if (!Number.isInteger(revision) || revision < 0) {
      fail(CODES.INVALID_FIELD, "revision must be a non-negative integer", { revision });
    }
    const existing = await db.query(
      "SELECT revision FROM tb_pins WHERE pin_name = $1",
      [pin],
    );
    if (existing.rows.length) {
      if (Number(existing.rows[0].revision) !== revision) {
        fail(P5_CODES.PIN_CONFLICT, `pin ${pin} already points at a different revision`, {
          pin,
        });
      }
      return { pin, revision, replayed: true };
    }
    // Fix round 1 (TBP5-004): a new pin above the admitted high-water
    // mark is refused, never stored. Revision 0 on an empty store is
    // valid. This check has no side effect on refusal.
    const latest = await latestRevision();
    if (revision > latest) {
      fail(P5_CODES.FUTURE_REVISION, `pin ${pin} at revision ${revision} is above the latest revision`, {
        pin,
        revision,
        latestRevision: latest,
      });
    }
    await db.query(
      "INSERT INTO tb_pins (pin_name, revision, pinned_at) VALUES ($1, $2, $3)",
      [pin, revision, new Date().toISOString()],
    );
    return { pin, revision, replayed: false };
  }

  // Read eligibility for one episode under one principal: existence,
  // allowed domain, and authorization. Used by the working-set setter
  // (refusals, before any displacement) and getter (revalidation on
  // read). A withheld reference discloses nothing: callers that fail
  // this check learn no content, only the refusal code.
  async function episodeReadEligibility(episodeId, principal) {
    const { rows } = await db.query(
      `SELECT e.scope, e.visibility, e.revision,
        EXISTS (SELECT 1 FROM tb_episode_grants g
                WHERE g.episode_id = e.episode_id AND g.principal = $2) AS granted
       FROM tb_episodes e WHERE e.episode_id = $1`,
      [episodeId, principal],
    );
    if (!rows.length) {
      fail(P5_CODES.UNKNOWN_EPISODE, `unknown episode: ${episodeId}`, { episodeId });
    }
    const row = rows[0];
    if (FORBIDDEN_SCOPES.includes(row.scope)) {
      fail(P5_CODES.FORBIDDEN_DOMAIN, `episode scope is excluded from retrieval: ${row.scope}`, {
        scope: row.scope,
      });
    }
    if (row.visibility !== "public" && !row.granted) {
      fail(P5_CODES.ACCESS_DENIED, `principal may not read episode: ${episodeId}`, {
        episodeId,
      });
    }
    return { scope: row.scope, visibility: row.visibility, revision: Number(row.revision) };
  }

  // Get the caller's four slots, revalidated on read (fix round 1,
  // TBP5-005). A slot whose reference is no longer eligible — episode
  // gone, scope forbidden, grant missing, revision diverged — reads
  // back as null, never as the forbidden identity.
  async function getWorkingSet(principal) {
    assertNonEmptyString(principal, "principal");
    const { rows } = await db.query(
      "SELECT slot, episode_id, revision FROM tb_working_set WHERE principal = $1 ORDER BY slot ASC",
      [principal],
    );
    const slots = { 1: null, 2: null, 3: null, 4: null };
    for (const row of rows) {
      let eligible = null;
      try {
        eligible = await episodeReadEligibility(row.episode_id, principal);
      } catch (err) {
        // Only eligibility refusals withhold the slot. A genuine
        // database failure must surface, never masquerade as withheld.
        if (err?.name !== "TeamBrainError") throw err;
        eligible = null;
      }
      if (eligible && eligible.revision === Number(row.revision)) {
        slots[row.slot] = { episodeId: row.episode_id, revision: Number(row.revision) };
      } else {
        slots[row.slot] = null;
      }
    }
    return slots;
  }

  // Displacement validates before writing (fix round 1, TBP5-005):
  // the episode must exist, be in an allowed scope, and be readable
  // by the slot owner, and the revision must be exactly the episode's
  // actual version (revision means episode version here). Every
  // refusal happens before the UPSERT, so a failed or denied
  // displacement preserves the prior valid slot.
  async function setWorkingSetSlot(principal, slot, episodeId, revision) {
    assertNonEmptyString(principal, "principal");
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
      fail(P5_CODES.INVALID_SLOT, "working-set slot must be an integer 1..4", { slot });
    }
    assertNonEmptyString(episodeId, "episodeId");
    if (!Number.isInteger(revision) || revision < 0) {
      fail(CODES.INVALID_FIELD, "revision must be a non-negative integer", { revision });
    }
    const eligible = await episodeReadEligibility(episodeId, principal);
    if (eligible.revision !== revision) {
      fail(P5_CODES.REVISION_MISMATCH, `revision ${revision} is not the episode version ${eligible.revision}`, {
        episodeId,
        revision,
        episodeRevision: eligible.revision,
      });
    }
    await db.query(
      `INSERT INTO tb_working_set (principal, slot, episode_id, revision)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (principal, slot) DO UPDATE
       SET episode_id = EXCLUDED.episode_id, revision = EXCLUDED.revision`,
      [principal, slot, episodeId, revision],
    );
    return { principal, slot, episodeId, revision };
  }

  // search_memory(query, scope, as_of). Every filter that can exclude
  // content — grants, visibility, forbidden scopes, scope, revision —
  // runs in SQL before ranking and limiting. The count reported is the
  // authorized count only; denied episodes are invisible to counts,
  // snippets, and diagnostics alike.
  async function searchMemory({ query = "", scope = null, asOf = null, pin = null, principal }) {
    assertNonEmptyString(principal, "principal");
    if (typeof query !== "string") {
      fail(CODES.INVALID_FIELD, "query must be a string", {});
    }
    const trimmed = query.trim();
    if (scope !== null) {
      assertNonEmptyString(scope, "scope");
      assertScopeAllowed(scope);
    }
    if (trimmed === "" && scope === null) {
      fail(
        P5_CODES.INVALID_SEARCH,
        "search requires a query or a scope",
        {},
      );
    }
    const asOfRevision = await resolveRevision({ asOf, pin });
    const latest = await latestRevision();

    let rows;
    let totalAuthorized;
    if (trimmed !== "") {
      // FTS branch + exact-ID branch, unioned. An exact-ID hit sorts
      // first (score 1e9, above any ts_rank); FTS hits rank by ts_rank.
      // Final tie-break chain is total: score, captured_at_ms, id.
      const qParams = [asOfRevision, principal];
      if (scope !== null) qParams.push(scope);
      const qIndex = qParams.length + 1;
      const idIndex = qParams.length + 2;
      const whereAuth = `
        e.revision <= $1
        AND e.scope NOT IN ('tenant', 'ledger', 'financial', 'enrollment', 'scheduling')
        AND (e.visibility = 'public' OR EXISTS (
          SELECT 1 FROM tb_episode_grants g
          WHERE g.episode_id = e.episode_id AND g.principal = $2
        ))
        ${scope !== null ? "AND e.scope = $3" : ""}
      `;
      const countRes = await db.query(
        `SELECT COUNT(*) AS total FROM (
          SELECT e.episode_id FROM tb_episodes e
          WHERE ${whereAuth} AND e.search_vector @@ plainto_tsquery('english', $${qIndex})
          UNION
          SELECT e.episode_id FROM tb_episodes e
          WHERE ${whereAuth} AND e.episode_id = $${idIndex}
        ) s`,
        [...qParams, trimmed, trimmed],
      );
      totalAuthorized = Number(countRes.rows[0].total);
      const searchRes = await db.query(
        `SELECT
          e.episode_id, e.scope, e.title, e.body, e.source_repo, e.source_path,
          e.source_commit, e.source_blob, e.source_watermark, e.captured_at,
          e.captured_at_ms, e.revision, e.state, e.visibility,
          e.provenance_status, e.conflict_group,
          CASE WHEN e.episode_id = $${idIndex} THEN 1000000000.0
               ELSE ts_rank(e.search_vector, plainto_tsquery('english', $${qIndex}))
          END AS score,
          CASE WHEN e.episode_id = $${idIndex} THEN left(e.body, ${SNIPPET_CHARS})
               ELSE ts_headline('english', e.body, plainto_tsquery('english', $${qIndex}), 'MaxWords=50, MinWords=20')
          END AS snippet
        FROM tb_episodes e
        WHERE ${whereAuth}
          AND (e.search_vector @@ plainto_tsquery('english', $${qIndex})
               OR e.episode_id = $${idIndex})
        ORDER BY score DESC, e.captured_at_ms DESC, e.episode_id ASC
        LIMIT ${MAX_RESULTS}`,
        [...qParams, trimmed, trimmed],
      );
      rows = searchRes.rows;
    } else {
      // Scope retrieval: no query text, deterministic recency order.
      const qParams = [asOfRevision, principal];
      if (scope !== null) qParams.push(scope);
      const whereAuth = `
        e.revision <= $1
        AND e.scope NOT IN ('tenant', 'ledger', 'financial', 'enrollment', 'scheduling')
        AND (e.visibility = 'public' OR EXISTS (
          SELECT 1 FROM tb_episode_grants g
          WHERE g.episode_id = e.episode_id AND g.principal = $2
        ))
        AND e.scope = $3
      `;
      const countRes = await db.query(
        `SELECT COUNT(*) AS total FROM tb_episodes e WHERE ${whereAuth}`,
        qParams,
      );
      totalAuthorized = Number(countRes.rows[0].total);
      const listRes = await db.query(
        `SELECT
          e.episode_id, e.scope, e.title, e.body, e.source_repo, e.source_path,
          e.source_commit, e.source_blob, e.source_watermark, e.captured_at,
          e.captured_at_ms, e.revision, e.state, e.visibility,
          e.provenance_status, e.conflict_group,
          0.0 AS score,
          left(e.body, ${SNIPPET_CHARS}) AS snippet
        FROM tb_episodes e
        WHERE ${whereAuth}
        ORDER BY e.captured_at_ms DESC, e.episode_id ASC
        LIMIT ${MAX_RESULTS}`,
        qParams,
      );
      rows = listRes.rows;
    }

    // Conflict metadata passes the SAME boundary as retrieval (fix
    // round 1, TBP5-001): authorization/source visibility,
    // allowed-domain, scope, and revision — before any member, count,
    // or flag is exposed. The FTS keyword match is deliberately NOT
    // applied to counterparts, so an authorized contrary statement is
    // never hidden by keyword mismatch; the access boundary is what
    // filters. A denied counterpart contributes nothing: no id in
    // conflictWith, no hasConflict, no uncertainty.
    const conflictGroups = [...new Set(rows.map((r) => r.conflict_group).filter(Boolean))];
    const conflictMap = new Map();
    if (conflictGroups.length) {
      const cParams = [conflictGroups, asOfRevision, principal];
      if (scope !== null) cParams.push(scope);
      const { rows: crows } = await db.query(
        `SELECT conflict_group, episode_id FROM tb_episodes e
         WHERE e.conflict_group = ANY($1) AND e.revision <= $2
         AND e.scope NOT IN ('tenant', 'ledger', 'financial', 'enrollment', 'scheduling')
         AND (e.visibility = 'public' OR EXISTS (
           SELECT 1 FROM tb_episode_grants g
           WHERE g.episode_id = e.episode_id AND g.principal = $3
         ))
         ${scope !== null ? "AND e.scope = $4" : ""}
         ORDER BY episode_id ASC`,
        cParams,
      );
      for (const row of crows) {
        if (!conflictMap.has(row.conflict_group)) conflictMap.set(row.conflict_group, []);
        conflictMap.get(row.conflict_group).push(row.episode_id);
      }
    }

    // Archive projection (fix round 1, TBP5-003): an archive event at
    // or below as_of makes the projected state ARCHIVED; an earlier
    // pin projects the original state. Capture-time ARCHIVED stays
    // ARCHIVED at every as_of.
    const archivedIds = new Set();
    if (rows.length) {
      const { rows: erows } = await db.query(
        `SELECT episode_id FROM tb_episode_events
         WHERE episode_id = ANY($1) AND event_type = 'ARCHIVED' AND revision <= $2`,
        [rows.map((r) => r.episode_id), asOfRevision],
      );
      for (const row of erows) archivedIds.add(row.episode_id);
    }

    const results = rows.map((row) => {
      const unavailable = row.provenance_status === "UNAVAILABLE";
      const conflictWith = row.conflict_group
        ? (conflictMap.get(row.conflict_group) ?? []).filter((id) => id !== row.episode_id)
        : [];
      return {
        episodeId: row.episode_id,
        scope: row.scope,
        title: row.title,
        // Withheld for unavailable provenance: no unattributed hit.
        snippet: unavailable ? null : row.snippet,
        body: unavailable ? null : row.body,
        score: Number(row.score),
        capturedAt: row.captured_at,
        revision: Number(row.revision),
        state: row.state === "ARCHIVED" || archivedIds.has(row.episode_id) ? "ARCHIVED" : "ACTIVE",
        // Freshness is relative to the query's snapshot boundary, not
        // the store's moving head: within a pinned as_of view, the
        // head episode of that snapshot is current. This keeps a
        // historical pin's results byte-stable across later captures
        // (fix round 1, TBP5-004). An unpinned search uses as_of =
        // latest, so the old latest-vs-older reading is unchanged.
        freshness: Number(row.revision) === asOfRevision ? "current" : "historical",
        provenanceStatus: row.provenance_status,
        unavailableReason: unavailable ? "MISSING_PROVENANCE" : null,
        hasConflict: conflictWith.length > 0,
        conflictWith,
        uncertainty:
          conflictWith.length > 0
            ? "CONFLICT_UNRESOLVED"
            : unavailable
              ? "PROVENANCE_UNAVAILABLE"
              : "NONE",
        citation: {
          episodeId: row.episode_id,
          source: {
            repo: row.source_repo,
            path: row.source_path,
            commit: row.source_commit,
            blob: row.source_blob,
          },
          revision: Number(row.revision),
          watermark: row.source_watermark,
        },
        dbRevision: asOfRevision,
        sourceWatermark: row.source_watermark,
      };
    });

    return {
      query: trimmed,
      scope,
      asOfRevision,
      latestRevision: latest,
      dbRevision: asOfRevision,
      totalAuthorized,
      truncated: totalAuthorized > MAX_RESULTS,
      uncertainty: totalAuthorized === 0 ? "NO_MATCH" : "NONE",
      results,
    };
  }

  // Public surface: every operation on this connection runs through
  // the shared connection lock (fix round 1, TBP5-002), so concurrent
  // calls in one process serialize end to end — read, check, write,
  // commit — and no caller's transaction can swallow another's
  // acknowledged work. Multi-statement transactions additionally bind
  // to one transaction owner via runTransaction (fix round 2,
  // TBP5-008): a checked-out client for pool-like handles, the
  // dedicated connection otherwise. Internal calls above use the
  // unlocked implementations directly; only the returned wrappers
  // lock, so there is no re-entrant deadlock.
  const withLock = connectionLock(db);
  return {
    migrate,
    latestRevision: (...args) => withLock(() => latestRevision(...args)),
    captureEpisode: (...args) => withLock(() => captureEpisode(...args)),
    grantEpisode: (...args) => withLock(() => grantEpisode(...args)),
    archiveEpisode: (...args) => withLock(() => archiveEpisode(...args)),
    pinRevision: (...args) => withLock(() => pinRevision(...args)),
    getWorkingSet: (...args) => withLock(() => getWorkingSet(...args)),
    setWorkingSetSlot: (...args) => withLock(() => setWorkingSetSlot(...args)),
    searchMemory: (...args) => withLock(() => searchMemory(...args)),
  };
}

export { CODES, P5_CODES };
