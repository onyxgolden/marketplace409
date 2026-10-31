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
//      or diagnostic metadata.
//   2. Deterministic ranking. Score DESC, captured_at_ms DESC,
//      episode_id ASC. Episode ids are unique, so the tie-break chain
//      is total: the same store + query always yields byte-identical
//      results.
//   3. Immutability. Episodes are never updated or deleted by this
//      adapter. A replayed capture (same deterministic id) is a no-op
//      that does not bump the revision. Archive flips only the state
//      flag; content, source, and revision never change.
//   4. In-process only (001A boundary). The revision bump is a single
//      transaction on one connection. No advisory lock, no fencing,
//      no cross-process safety is claimed: two processes capturing
//      concurrently may interleave revisions. Do not deploy this
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
  });
  return `ep-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export function loadSchemaSql() {
  return readFileSync(join(HERE, "schema.sql"), "utf8");
}

export async function migrate(db) {
  await db.exec(loadSchemaSql());
}

export function createRetrievalRepository(db) {
  async function latestRevision() {
    const { rows } = await db.query(
      "SELECT revision FROM tb_retrieval_revisions WHERE id = 1",
    );
    return rows.length ? Number(rows[0].revision) : 0;
  }

  async function resolveRevision({ asOf = null, pin = null } = {}) {
    if (asOf !== null && pin !== null) {
      fail(CODES.INVALID_FIELD, "asOf and pin are mutually exclusive", {});
    }
    if (pin !== null) {
      assertNonEmptyString(pin, "pin");
      const { rows } = await db.query(
        "SELECT revision FROM tb_pins WHERE pin_name = $1",
        [pin],
      );
      if (!rows.length) {
        fail(P5_CODES.UNKNOWN_PIN, `unknown pin: ${pin}`, { pin });
      }
      return Number(rows[0].revision);
    }
    if (asOf !== null) {
      if (!Number.isInteger(asOf) || asOf < 0) {
        fail(CODES.INVALID_FIELD, "asOf must be a non-negative integer revision", {
          asOf,
        });
      }
      return asOf;
    }
    return latestRevision();
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
    const grants = episode.grants ?? [];
    if (!Array.isArray(grants) || grants.some((g) => typeof g !== "string" || g === "")) {
      fail(CODES.INVALID_FIELD, "grants must be an array of non-empty strings", {});
    }
    if (episode.conflictGroup !== undefined && episode.conflictGroup !== null) {
      assertNonEmptyString(episode.conflictGroup, "conflictGroup");
    }

    const episodeId = computeEpisodeId(episode);
    const existing = await db.query(
      "SELECT revision FROM tb_episodes WHERE episode_id = $1",
      [episodeId],
    );
    if (existing.rows.length) {
      return {
        episodeId,
        revision: Number(existing.rows[0].revision),
        replayed: true,
      };
    }

    const capturedAtMs = utcIsoToMs(episode.capturedAt, "capturedAt");
    try {
      await db.query("BEGIN");
      const bumped = await db.query(
        "UPDATE tb_retrieval_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision",
      );
      const revision = Number(bumped.rows[0].revision);
      await db.query(
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
      for (const principal of grants) {
        await db.query(
          "INSERT INTO tb_episode_grants (episode_id, principal) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [episodeId, principal],
        );
      }
      await db.query("COMMIT");
      return { episodeId, revision, replayed: false };
    } catch (err) {
      try {
        await db.query("ROLLBACK");
      } catch {
        // Rollback failure must not mask the original error.
      }
      throw err;
    }
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

  // Archive flips only the state flag. Content, source, and revision
  // never change; archived episodes stay retrievable, flagged ARCHIVED.
  async function archiveEpisode(episodeId) {
    assertNonEmptyString(episodeId, "episodeId");
    const { rows } = await db.query(
      "UPDATE tb_episodes SET state = 'ARCHIVED' WHERE episode_id = $1 RETURNING episode_id",
      [episodeId],
    );
    if (!rows.length) {
      fail(P5_CODES.UNKNOWN_EPISODE, `unknown episode: ${episodeId}`, { episodeId });
    }
    return { episodeId, state: "ARCHIVED" };
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
    await db.query(
      "INSERT INTO tb_pins (pin_name, revision, pinned_at) VALUES ($1, $2, $3)",
      [pin, revision, new Date().toISOString()],
    );
    return { pin, revision, replayed: false };
  }

  async function getWorkingSet(principal) {
    assertNonEmptyString(principal, "principal");
    const { rows } = await db.query(
      "SELECT slot, episode_id, revision FROM tb_working_set WHERE principal = $1 ORDER BY slot ASC",
      [principal],
    );
    const slots = { 1: null, 2: null, 3: null, 4: null };
    for (const row of rows) {
      slots[row.slot] = { episodeId: row.episode_id, revision: Number(row.revision) };
    }
    return slots;
  }

  // Displacement writes through in a single UPSERT: if the write fails,
  // the previous slot value remains (the adapter holds no in-memory
  // copy that could diverge from the stored slot).
  async function setWorkingSetSlot(principal, slot, episodeId, revision) {
    assertNonEmptyString(principal, "principal");
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
      fail(P5_CODES.INVALID_SLOT, "working-set slot must be an integer 1..4", { slot });
    }
    assertNonEmptyString(episodeId, "episodeId");
    if (!Number.isInteger(revision) || revision < 0) {
      fail(CODES.INVALID_FIELD, "revision must be a non-negative integer", { revision });
    }
    const found = await db.query(
      "SELECT 1 FROM tb_episodes WHERE episode_id = $1",
      [episodeId],
    );
    if (!found.rows.length) {
      fail(P5_CODES.UNKNOWN_EPISODE, `unknown episode: ${episodeId}`, { episodeId });
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

    const conflictGroups = [...new Set(rows.map((r) => r.conflict_group).filter(Boolean))];
    const conflictMap = new Map();
    if (conflictGroups.length) {
      const { rows: crows } = await db.query(
        `SELECT conflict_group, episode_id FROM tb_episodes
         WHERE conflict_group = ANY($1) AND revision <= $2
         ORDER BY episode_id ASC`,
        [conflictGroups, asOfRevision],
      );
      for (const row of crows) {
        if (!conflictMap.has(row.conflict_group)) conflictMap.set(row.conflict_group, []);
        conflictMap.get(row.conflict_group).push(row.episode_id);
      }
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
        state: row.state,
        freshness: Number(row.revision) === latest ? "current" : "historical",
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

  return {
    migrate,
    latestRevision,
    captureEpisode,
    grantEpisode,
    archiveEpisode,
    pinRevision,
    getWorkingSet,
    setWorkingSetSlot,
    searchMemory,
  };
}

export { CODES, P5_CODES };
