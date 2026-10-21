// Team Brain P1 — production PostgreSQL transactional repository adapter.
//
// Replaces the prototype's optional non-transactional fallback. Every
// lifecycle transition runs inside an explicit BEGIN/COMMIT/ROLLBACK on a
// single dedicated connection from the pool. Lifecycle transitions are
// serialized by the guarded SECURITY DEFINER functions, which lock the
// target rows (SELECT ... FOR UPDATE, as tb_owner) and re-validate every
// predicate under the lock; serialization (40001) and deadlock (40P01)
// errors retry with a bounded limit under the SAME operation ID, so a
// retry never creates a duplicate logical operation.
//
// Boundaries (brief Section 3, P1):
//   - No Git network, no daemon, no migration apply in this adapter.
//   - Statement timeout 5s, lock wait 1s (brief Section 7).
//   - Never hold a transaction while waiting on Git/network (no Git here).
//
// Filing contract (fix round 2, TBP1-004): the adapter targets the
// NORMALIZED production schema, not the prototype's flat source columns.
// An obligation is filed against a validated source identity — either an
// existing source_id, or a source { repo, path, commit, blob } identity that
// is already registered in team_brain.source_objects (see
// registerSourceObject). owner is required on every record; VERDICT
// obligations additionally require a reviewed head (record.reviewedHead or
// source.head). The adapter boundary refuses incomplete provenance: it never
// synthesizes content_sha256, byte_length, source_class, observed_at, or
// transport_receipt, because doing so would turn incomplete provenance into
// trusted persistence. Provenance is registered first, by an explicit
// registerSourceObject call or an earlier trusted-ingress slice.
// Lifecycle transitions run through the guarded SECURITY DEFINER functions
// in the migration (TB2xx errcodes); mapGuardError translates those onto the
// adapter's typed codes so direct-call and adapter-call refusals agree.

import { CODES, fail, TeamBrainError } from "../ledger/errors.mjs";
import {
  assertNonEmptyString,
  assertSourceBinding,
  assertStringArray,
  assertUniqueStringArray,
  assertUtcIso,
  utcIsoToMs,
} from "../ledger/validation.mjs";
import { validateOverride } from "../queue/projection.mjs";

const KINDS = ["TASK", "AUTHORIZATION", "VERDICT", "EVIDENCE"];
const TERMINAL_STATES = ["CLOSED", "REVOKED", "SUPERSEDED"];
const ANNOTATION_EVENT_TYPES = ["NOTE", "REPING_SENT", "REPORT_TO_JASON_SENT"];

// Closed retention-disposition policy set. Mirrors the domain enforced in
// the database by tb_set_retention_disposition (TB208) and the persistence
// contract's Section 1 language: a task closes only on verified completion;
// an authorization stands until explicitly revoked; a verdict stands until
// superseded at a new head; evidence is immutable, corrections link.
export const RETENTION_DISPOSITIONS = [
  "PERMANENT",
  "UNTIL_VERIFIED_COMPLETION",
  "UNTIL_EXPLICITLY_REVOKED",
  "UNTIL_SUPERSEDED_AT_NEW_HEAD",
  "IMMUTABLE_CORRECTIONS_LINK",
  "RETAIN_1Y",
  "RETAIN_7Y",
  "ARCHIVE_AFTER_30D",
];

const HEX40_RE = /^[0-9a-f]{40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function assertRetentionDisposition(value) {
  assertNonEmptyString(value, "retentionDisposition");
  if (!RETENTION_DISPOSITIONS.includes(value)) {
    fail(
      CODES.INVALID_RETENTION_DISPOSITION,
      `Retention disposition ${JSON.stringify(value)} is not in the policy set`,
      { disposition: value },
    );
  }
  return value;
}

// Translate a guarded-function TB2xx errcode onto the adapter's typed error
// codes. TB202 (wrong kind) has no single adapter code — the caller passes
// the kind-specific code (NOT_A_TASK / NOT_AN_AUTHORIZATION / NOT_A_VERDICT);
// anything unmapped is rethrown untouched. Fix round 3 (TBP1-002A/B/C):
// TB214/TB220/TB221/TB222 are the INVALID_OVERRIDE family (override payload
// unparseable / structure / recordedAt / rank), TB223 is malformed
// verification evidence at close (UNVERIFIED_EVIDENCE), and TB224 is
// invalid transition metadata on close/revoke/retention (INVALID_FIELD).
function mapGuardError(err, kindCode = CODES.ILLEGAL_STATE_TRANSITION) {
  const map = {
    TB201: CODES.UNKNOWN_OBLIGATION,
    TB202: kindCode,
    TB203: CODES.ALREADY_TERMINAL,
    TB204: CODES.NO_VERIFICATION,
    TB205: CODES.MISSING_EVIDENCE,
    TB206: CODES.UNVERIFIED_EVIDENCE,
    TB207: CODES.SUPERSESSION_BINDING_MISMATCH,
    TB208: CODES.INVALID_RETENTION_DISPOSITION,
    TB209: CODES.SAME_HEAD_SUPERSESSION,
    TB210: CODES.STALE_VERDICT_SUPERSESSION,
    TB214: CODES.INVALID_OVERRIDE,
    TB215: CODES.UNKNOWN_AUTHORITY,
    TB216: CODES.INVALID_OVERRIDE,
    TB217: CODES.INVALID_OVERRIDE,
    TB218: CODES.INVALID_OVERRIDE,
    TB219: CODES.INVALID_OVERRIDE,
    TB220: CODES.INVALID_OVERRIDE,
    TB221: CODES.INVALID_OVERRIDE,
    TB222: CODES.INVALID_OVERRIDE,
    TB223: CODES.UNVERIFIED_EVIDENCE,
    TB224: CODES.INVALID_FIELD,
  };
  const mapped = err && typeof err.code === "string" ? map[err.code] : undefined;
  if (mapped) {
    throw new TeamBrainError(mapped, err.message, {});
  }
  throw err;
}

// Postgres error codes that are safe to retry with the same operation ID.
const RETRYABLE_CODES = new Set(["40001", "40P01"]);
const MAX_TX_RETRIES = 3;

function isRetryable(err) {
  return err && typeof err.code === "string" && RETRYABLE_CODES.has(err.code);
}

function rowToObligation(row, dependencies, links = {}) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v);
  return {
    id: row.obligation_id,
    kind: row.kind,
    filedAt: iso(row.filed_at),
    sourceId: row.source_id,
    source: row.so_repo
      ? {
          repo: row.so_repo,
          path: row.so_path,
          commit: row.so_commit,
          blob: row.so_blob,
          head: row.reviewed_head ?? row.so_reviewed_head ?? undefined,
        }
      : null,
    owner: row.owner,
    resourceRepo: row.resource_repo,
    resourceScope: row.resource_scope,
    reviewedHead: row.reviewed_head,
    state: row.state,
    retentionDisposition: row.retention_disposition,
    dependencies: dependencies || [],
    supersedes: links.supersedes ?? null,
    supersededBy: links.supersededBy ?? null,
    priorityOverride: row.ov_override_json ? JSON.parse(row.ov_override_json) : null,
    createdAt: iso(row.created_at),
  };
}

export function createPostgresRepository(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("createPostgresRepository requires a pg Pool (pool.connect)");
  }

  // Trust is never caller-injected: every override is checked against the
  // protected team_brain.trusted_authorizations rows as they stand in the
  // SAME transaction as the write, so a revocation already committed when
  // this transaction began is honored, and nothing a caller passes in can
  // forge or stale-date a grant.
  async function loadTrustedAuthorizations(runner) {
    const res = await runner.query(
      `select grant_id as id, granter_principal_id as granter, override_item as "itemId",
              override_rank as rank, (revoked_at is not null) as revoked
         from team_brain.trusted_authorizations`,
    );
    return res.rows;
  }

  // Run work inside one explicit transaction on a single connection.
  // Always BEGIN/COMMIT/ROLLBACK; never the prototype's sequential fallback.
  // Retries serialization/deadlock with the same operation identity.
  async function tx(work, { operationId = null } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Per-transaction timeouts (brief Section 7).
        await client.query("SET LOCAL statement_timeout = '5s'");
        await client.query("SET LOCAL lock_timeout = '1s'");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Rollback failure: connection is broken; release handles it.
        }
        lastErr = err;
        if (isRetryable(err) && attempt < MAX_TX_RETRIES) {
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
    throw lastErr;
  }

  // Joined read: the obligation row plus its registered source identity and
  // priority override, so rowToObligation never invents flat source columns.
  const OBLIGATION_SELECT = `
    select o.*, s.repo as so_repo, s.path as so_path, s.commit as so_commit,
           s.blob as so_blob, s.reviewed_head as so_reviewed_head,
           ov.override_json as ov_override_json
      from team_brain.obligations o
      left join team_brain.source_objects s on s.source_id = o.source_id
      left join team_brain.obligation_overrides ov on ov.obligation_id = o.obligation_id`;

  async function getRaw(runner, id) {
    const res = await runner.query(`${OBLIGATION_SELECT} where o.obligation_id = $1`, [id]);
    return res.rows[0] || null;
  }

  // Pre-transition read for lifecycle methods. This deliberately takes NO
  // row lock: PostgreSQL requires UPDATE privilege for every row-lock mode
  // (FOR UPDATE / FOR NO KEY UPDATE / FOR SHARE / FOR KEY SHARE alike), and
  // tb_coordinator holds no UPDATE on obligations by design (TBP1-002) — a
  // locking read would fail 42501 for the worker role before any guarded
  // function ran (verified against the migration: plain SELECT is allowed,
  // all four lock modes are denied). Serialization lives in the guarded
  // SECURITY DEFINER functions instead: each locks the target row(s)
  // SELECT ... FOR UPDATE as tb_owner and re-validates every predicate
  // under that lock, so the adapter's pre-checks here are fast-fail only
  // and no invariant depends on them.
  async function getRawForUpdate(runner, id) {
    const res = await runner.query(`${OBLIGATION_SELECT} where o.obligation_id = $1`, [id]);
    return res.rows[0] || null;
  }

  // Supersession links for one obligation from the append-only
  // obligation_supersessions relation (earliest recorded row wins).
  async function getSupersessionLinks(runner, id) {
    const res = await runner.query(
      `select old_obligation_id, new_obligation_id from team_brain.obligation_supersessions
        where old_obligation_id = $1 or new_obligation_id = $1 order by recorded_at asc`,
      [id],
    );
    let supersedes = null;
    let supersededBy = null;
    for (const r of res.rows) {
      if (r.old_obligation_id === id && supersededBy === null) supersededBy = r.new_obligation_id;
      if (r.new_obligation_id === id && supersedes === null) supersedes = r.old_obligation_id;
    }
    return { supersedes, supersededBy };
  }

  async function requireObligation(runner, id, { forUpdate = false } = {}) {
    const row = forUpdate ? await getRawForUpdate(runner, id) : await getRaw(runner, id);
    if (!row) {
      fail(CODES.UNKNOWN_OBLIGATION, `Unknown obligation: ${id}`, { id });
    }
    return rowToObligation(
      row,
      await getDependencyIds(runner, id),
      await getSupersessionLinks(runner, id),
    );
  }

  // Resolve a filing record to a registered source_id, or refuse. The
  // adapter NEVER synthesizes provenance fields (content_sha256, byte_length,
  // source_class, observed_at, transport_receipt): a source identity must
  // already be registered in source_objects (registerSourceObject), because
  // inventing those fields would turn incomplete provenance into trusted
  // persistence.
  async function resolveSourceId(runner, record) {
    if (record.sourceId != null) {
      assertNonEmptyString(record.sourceId, "sourceId");
      const res = await runner.query(
        "select source_id from team_brain.source_objects where source_id = $1",
        [record.sourceId],
      );
      if (res.rows.length === 0) {
        fail(CODES.UNKNOWN_SOURCE, `Unknown source_id: ${record.sourceId}`, {
          sourceId: record.sourceId,
        });
      }
      return record.sourceId;
    }
    if (record.source) {
      const source = assertSourceBinding(record.source);
      const missing = [];
      if (!source.commit) missing.push("commit");
      if (!source.blob) missing.push("blob");
      if (missing.length > 0) {
        fail(
          CODES.INCOMPLETE_PROVENANCE,
          `Source identity for ${record.id} is missing ${missing.join(", ")}; the adapter never synthesizes content_sha256, byte_length, source_class, observed_at, or transport_receipt — provenance must be registered first (registerSourceObject or an existing source_id)`,
          { id: record.id, missing },
        );
      }
      if (!HEX40_RE.test(source.commit) || !HEX40_RE.test(source.blob)) {
        fail(
          CODES.INCOMPLETE_PROVENANCE,
          `Source identity for ${record.id} must carry full 40-hex commit and blob`,
          { id: record.id },
        );
      }
      const res = await runner.query(
        `select source_id from team_brain.source_objects
          where repo = $1 and path = $2 and commit = $3 and blob = $4`,
        [source.repo, source.path, source.commit, source.blob],
      );
      if (res.rows.length === 0) {
        fail(
          CODES.INCOMPLETE_PROVENANCE,
          `Source identity for ${record.id} is not registered in source_objects; register provenance first (registerSourceObject)`,
          { id: record.id },
        );
      }
      return res.rows[0].source_id;
    }
    fail(
      CODES.MISSING_SOURCE_BINDING,
      `Obligation ${record.id} requires a sourceId or a registered source identity`,
      { id: record.id },
    );
  }

  async function getDependencyIds(runner, id) {
    const res = await runner.query(
      "select depends_on_id from team_brain.obligation_dependencies where obligation_id = $1 order by depends_on_id asc",
      [id],
    );
    return res.rows.map((r) => r.depends_on_id);
  }

  // Routed through tb_insert_dependency_edge: a SECURITY DEFINER function
  // that takes a cluster-wide advisory lock before checking reachability, so
  // two concurrent transactions can never jointly create a cycle that
  // neither would see alone (brief TBP1-003). tb_coordinator has no direct
  // INSERT on obligation_dependencies -- this function is the only path.
  async function insertDependencyEdges(runner, id, dependencies) {
    for (const dep of dependencies) {
      try {
        await runner.query("select team_brain.tb_insert_dependency_edge($1, $2)", [id, dep]);
      } catch (err) {
        if (err && err.code === "TB001") {
          fail(CODES.DEPENDENCY_CYCLE, `Obligation ${id} cannot depend on ${dep}: would create a cycle`, {
            id,
            dependsOn: dep,
          });
        }
        throw err;
      }
    }
  }

  function requireKind(obligation, kind, code) {
    if (obligation.kind !== kind) {
      fail(code, `Obligation ${obligation.id} is kind ${obligation.kind}, not ${kind}`, {
        id: obligation.id,
        kind: obligation.kind,
      });
    }
  }

  function requireOpen(obligation) {
    if (TERMINAL_STATES.includes(obligation.state)) {
      fail(CODES.ALREADY_TERMINAL, `Obligation ${obligation.id} is already terminal (${obligation.state})`, {
        id: obligation.id,
        state: obligation.state,
      });
    }
  }

  // Idempotency: the same operation ID (idempotency_key) never inserts twice.
  // Returns the existing event row when the key is already present.
  async function insertEventIdempotent(runner, obligationId, event) {
    const { actor, recordedAt, eventType, reason, evidenceRefs = [], extra = {}, idempotencyKey = null } = event;
    assertNonEmptyString(actor, "actor");
    assertUtcIso(recordedAt, "recordedAt");
    assertNonEmptyString(reason, "reason");
    assertStringArray(evidenceRefs, "evidenceRefs");
    if (idempotencyKey === null) {
      await runner.query(
        `insert into team_brain.obligation_events
           (event_id, obligation_id, actor_principal, claimed_at, event_type, reason,
            evidence_links, idempotency_key, canonical_payload_sha256)
         values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, null, $7)`,
        [
          obligationId,
          actor,
          recordedAt,
          eventType,
          reason,
          JSON.stringify(evidenceRefs),
          extra.canonicalPayloadSha256 || null,
        ],
      );
      return { inserted: true };
    }
    try {
      await runner.query(
        `insert into team_brain.obligation_events
           (event_id, obligation_id, actor_principal, claimed_at, event_type, reason,
            evidence_links, idempotency_key, canonical_payload_sha256)
         values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          obligationId,
          actor,
          recordedAt,
          eventType,
          reason,
          JSON.stringify(evidenceRefs),
          idempotencyKey,
          extra.canonicalPayloadSha256 || null,
        ],
      );
      return { inserted: true };
    } catch (err) {
      if (/duplicate key|unique/i.test(String(err && err.message))) {
        return { inserted: false, duplicate: true };
      }
      throw err;
    }
  }

  async function insertEvent(runner, obligationId, opts) {
    const r = await insertEventIdempotent(runner, obligationId, opts);
    if (r.duplicate) {
      fail(CODES.DUPLICATE_OPERATION, `Duplicate operation idempotency key for ${obligationId}`, {
        id: obligationId,
      });
    }
  }

  async function fileObligationRow(runner, record, createdAt, internal = {}) {
    const {
      id,
      kind,
      filedAt,
      owner,
      retentionDisposition,
      dependencies = [],
      supersedes = null,
      priorityOverride = null,
    } = record;
    assertNonEmptyString(id, "id");
    if (!KINDS.includes(kind)) {
      fail(CODES.INVALID_KIND, `Invalid obligation kind: ${JSON.stringify(kind)}`, { kind });
    }
    assertUtcIso(filedAt, "filedAt");
    if (typeof owner !== "string" || owner.trim() === "") {
      fail(CODES.INVALID_FIELD, "owner is required", { id, field: "owner" });
    }
    assertRetentionDisposition(retentionDisposition);
    assertUniqueStringArray(dependencies, "dependencies");
    if (dependencies.includes(id)) {
      fail(CODES.SELF_DEPENDENCY, `Obligation ${id} may not depend on itself`, { id });
    }
    if (supersedes !== null) {
      assertNonEmptyString(supersedes, "supersedes");
      if (supersedes === id) {
        fail(CODES.SELF_SUPERSESSION, `Obligation ${id} may not supersede itself`, { id });
      }
      if (kind === "VERDICT" && !internal.verdictSupersession) {
        fail(
          CODES.UNGUARDED_VERDICT_SUPERSESSION,
          `Verdict ${id} may not be filed with a supersession link; use supersedeVerdict`,
          { id, supersedes },
        );
      }
      const target = await getRaw(runner, supersedes);
      if (!target) {
        fail(CODES.UNKNOWN_OBLIGATION, `Supersession target does not exist: ${supersedes}`, { id: supersedes });
      }
    }
    // Normalized filing: provenance resolves to a registered source_id or
    // the filing is refused at this boundary (never synthesized).
    const sourceId = await resolveSourceId(runner, record);
    const reviewedHead = record.reviewedHead ?? record.source?.head ?? null;
    if (kind === "VERDICT" && !reviewedHead) {
      fail(CODES.MISSING_SOURCE_BINDING, "VERDICT obligations require a reviewed head", { id });
    }
    if (reviewedHead !== null && !HEX40_RE.test(reviewedHead)) {
      fail(CODES.INVALID_FIELD, `reviewedHead for ${id} must be a full 40-hex head`, {
        id,
        field: "reviewedHead",
      });
    }
    const resourceRepo = record.resourceRepo ?? record.source?.repo ?? null;
    const resourceScope = record.resourceScope ?? null;
    // Trust is validated BEFORE anything persists, against the live
    // trusted_authorizations rows in this same transaction; the guarded
    // tb_upsert_override re-validates inside the database after insert.
    if (priorityOverride !== null) {
      validateOverride(id, priorityOverride, {
        trustedAuthorizations: await loadTrustedAuthorizations(runner),
      });
    }
    // Idempotent filing: same obligation_id is a duplicate, surfaced as a
    // typed error (never a silent second row).
    try {
      await runner.query(
        `insert into team_brain.obligations
           (obligation_id, kind, filed_at, source_id, resource_repo, resource_scope,
            reviewed_head, owner, state, retention_disposition, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10)`,
        [
          id,
          kind,
          filedAt,
          sourceId,
          resourceRepo,
          resourceScope,
          reviewedHead,
          owner,
          retentionDisposition,
          createdAt,
        ],
      );
    } catch (err) {
      if (err instanceof TeamBrainError) throw err;
      if (/duplicate key|unique/i.test(String(err && err.message))) {
        fail(CODES.DUPLICATE_OBLIGATION, `Duplicate obligation id: ${id}`, { id });
      }
      throw err;
    }
    if (priorityOverride !== null) {
      await upsertOverride(runner, id, priorityOverride);
    }
    if (!internal.allowForwardRefs) {
      for (const dep of dependencies) {
        const target = await getRaw(runner, dep);
        if (!target) {
          fail(CODES.UNKNOWN_OBLIGATION, `Unknown dependency ${dep} for obligation ${id}`, {
            id,
            dependency: dep,
          });
        }
      }
    }
    await insertDependencyEdges(runner, id, dependencies);
    // Filing-time supersession link for non-verdict kinds, recorded through
    // the guarded recorder (verdict supersession goes through
    // tb_supersede_verdict via supersedeVerdict instead).
    if (supersedes !== null && !internal.verdictSupersession) {
      try {
        await runner.query(
          "select team_brain.tb_record_obligation_supersession($1, $2, $3, $4)",
          [supersedes, id, record.filedBy || "system", record.filedReason || "filed with supersession link"],
        );
      } catch (err) {
        mapGuardError(err);
      }
    }
    await insertEvent(runner, id, {
      actor: record.filedBy || "system",
      recordedAt: filedAt,
      eventType: "FILED",
      reason: record.filedReason || "obligation filed",
      evidenceRefs: [],
      extra: { kind },
      idempotencyKey: `file:${id}`,
    });
    return requireObligation(runner, id);
  }

  // The obligations table in the production schema has no priority_override
  // column; overrides live in team_brain.obligation_overrides (created by the
  // migration, not here -- tb_coordinator has no CREATE privilege on the
  // schema). Writes go through tb_upsert_override; tb_coordinator only has
  // SELECT on the table itself.
  async function upsertOverride(runner, obligationId, override) {
    try {
      await runner.query("select team_brain.tb_upsert_override($1, $2)", [
        obligationId,
        JSON.stringify(override),
      ]);
    } catch (err) {
      mapGuardError(err, CODES.INVALID_OVERRIDE);
    }
  }

  return {
    // Apply the production migration. Intended for isolated test databases
    // and operator-invoked production apply only. Never called by a deploy.
    async migrate(clientOrPool) {
      const runner = clientOrPool && clientOrPool.query ? clientOrPool : pool;
      const fs = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const here = dirname(fileURLToPath(import.meta.url));
      const sql = fs.readFileSync(
        join(here, "..", "migrations", "production", "001_team_brain_production.sql"),
        "utf8",
      );
      await runner.query(sql);
    },

    // Register an immutable source identity. This is the ONLY way provenance
    // fields (content_sha256, byte_length, source_class, observed_at,
    // transport_receipt) enter the system: explicitly, from the caller that
    // observed them — the adapter never synthesizes them at filing time.
    // Re-registering the same source_id with the same identity is a no-op;
    // a different identity under the same source_id is refused.
    async registerSourceObject(record) {
      return tx(async (t) => {
        const sourceId = assertNonEmptyString(record.sourceId, "sourceId");
        const repo = assertNonEmptyString(record.repo, "repo");
        const path = assertNonEmptyString(record.path, "path");
        if (!HEX40_RE.test(record.commit || "")) {
          fail(CODES.INVALID_FIELD, "commit must be a full 40-hex value", { field: "commit" });
        }
        if (!HEX40_RE.test(record.blob || "")) {
          fail(CODES.INVALID_FIELD, "blob must be a full 40-hex value", { field: "blob" });
        }
        const algorithm = record.algorithm ?? "git-sha1";
        if (!["git-sha1", "sha256"].includes(algorithm)) {
          fail(CODES.INVALID_FIELD, `Invalid source algorithm: ${JSON.stringify(algorithm)}`, {
            field: "algorithm",
          });
        }
        const reviewedHead = record.reviewedHead ?? null;
        if (reviewedHead !== null && !HEX40_RE.test(reviewedHead)) {
          fail(CODES.INVALID_FIELD, "reviewedHead must be a full 40-hex value when present", {
            field: "reviewedHead",
          });
        }
        if (!Number.isInteger(record.byteLength) || record.byteLength < 0) {
          fail(CODES.INVALID_FIELD, "byteLength is required and must be an integer >= 0", {
            field: "byteLength",
          });
        }
        if (!HEX64_RE.test(record.contentSha256 || "")) {
          fail(CODES.INVALID_FIELD, "contentSha256 is required and must be a full 64-hex SHA-256", {
            field: "contentSha256",
          });
        }
        const sourceClass = assertNonEmptyString(record.sourceClass, "sourceClass");
        const observedAt = assertUtcIso(record.observedAt, "observedAt");
        const transportReceipt = assertNonEmptyString(record.transportReceipt, "transportReceipt");
        const provenanceStatus = record.provenanceStatus ?? "UNVERIFIED";
        if (!["UNVERIFIED", "VERIFIED", "AUTH_UNVERIFIED", "REJECTED"].includes(provenanceStatus)) {
          fail(CODES.INVALID_FIELD, `Invalid provenanceStatus: ${JSON.stringify(provenanceStatus)}`, {
            field: "provenanceStatus",
          });
        }
        await t.query(
          `insert into team_brain.source_objects
             (source_id, repo, path, commit, blob, algorithm, reviewed_head, byte_length,
              content_sha256, source_class, observed_at, transport_receipt, provenance_status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (source_id) do nothing`,
          [
            sourceId,
            repo,
            path,
            record.commit,
            record.blob,
            algorithm,
            reviewedHead,
            record.byteLength,
            record.contentSha256,
            sourceClass,
            observedAt,
            transportReceipt,
            provenanceStatus,
          ],
        );
        const res = await t.query(
          "select * from team_brain.source_objects where source_id = $1",
          [sourceId],
        );
        const row = res.rows[0];
        if (
          !row ||
          row.repo !== repo ||
          row.path !== path ||
          row.commit !== record.commit ||
          row.blob !== record.blob
        ) {
          fail(CODES.INVALID_FIELD, "source_id already registered with a different identity", {
            sourceId,
          });
        }
        return {
          sourceId: row.source_id,
          repo: row.repo,
          path: row.path,
          commit: row.commit,
          blob: row.blob,
          algorithm: row.algorithm,
          reviewedHead: row.reviewed_head,
          byteLength: Number(row.byte_length),
          contentSha256: row.content_sha256,
          sourceClass: row.source_class,
          observedAt:
            row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
          transportReceipt: row.transport_receipt,
          provenanceStatus: row.provenance_status,
        };
      });
    },

    async fileObligation(record, createdAt) {
      return tx(
        async (t) => fileObligationRow(t, record, createdAt || record.filedAt),
        { operationId: `file:${record.id}` },
      );
    },

    async fileObligationBatch(records, createdAt) {
      if (!Array.isArray(records) || records.length === 0) {
        fail(CODES.INVALID_FIELD, "fileObligationBatch requires a non-empty array of records", {});
      }
      return tx(async (t) => {
        const created = [];
        for (const record of records) {
          created.push(
            await fileObligationRow(t, record, createdAt || record.filedAt, {
              allowForwardRefs: true,
            }),
          );
        }
        return created;
      });
    },

    async getObligation(id) {
      return tx((t) => requireObligation(t, id));
    },

    async listObligations() {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `${OBLIGATION_SELECT} order by o.filed_at asc, o.obligation_id asc`,
        );
        const depRes = await client.query(
          "select obligation_id, depends_on_id from team_brain.obligation_dependencies order by obligation_id asc, depends_on_id asc",
        );
        const depMap = new Map();
        for (const r of depRes.rows) {
          if (!depMap.has(r.obligation_id)) depMap.set(r.obligation_id, []);
          depMap.get(r.obligation_id).push(r.depends_on_id);
        }
        const supRes = await client.query(
          "select old_obligation_id, new_obligation_id from team_brain.obligation_supersessions order by recorded_at asc",
        );
        const linkMap = new Map();
        for (const r of supRes.rows) {
          const oldLinks = linkMap.get(r.old_obligation_id) || { supersedes: null, supersededBy: null };
          if (oldLinks.supersededBy === null) oldLinks.supersededBy = r.new_obligation_id;
          linkMap.set(r.old_obligation_id, oldLinks);
          const newLinks = linkMap.get(r.new_obligation_id) || { supersedes: null, supersededBy: null };
          if (newLinks.supersedes === null) newLinks.supersedes = r.old_obligation_id;
          linkMap.set(r.new_obligation_id, newLinks);
        }
        return res.rows.map((row) =>
          rowToObligation(row, depMap.get(row.obligation_id) || [], linkMap.get(row.obligation_id) || {}),
        );
      } finally {
        client.release();
      }
    },

    async getEvents(id) {
      return tx(async (t) => {
        await requireObligation(t, id);
        const res = await t.query(
          "select * from team_brain.obligation_events where obligation_id = $1 order by seq asc",
          [id],
        );
        return res.rows.map((r) => ({
          seq: Number(r.seq),
          obligationId: r.obligation_id,
          actor: r.actor_principal,
          recordedAt: r.claimed_at instanceof Date ? r.claimed_at.toISOString() : r.claimed_at,
          eventType: r.event_type,
          reason: r.reason,
          evidenceRefs: JSON.parse(r.evidence_links || "[]"),
          extra: {},
        }));
      });
    },

    async appendAnnotation(id, { actor, recordedAt, eventType, reason, evidenceRefs = [] }) {
      if (!ANNOTATION_EVENT_TYPES.includes(eventType)) {
        fail(CODES.ILLEGAL_STATE_TRANSITION, `Event type ${eventType} is not an annotation; lifecycle transitions require the guarded methods`, {
          id,
          eventType,
        });
      }
      return tx(async (t) => {
        await requireObligation(t, id, { forUpdate: true });
        await insertEvent(t, id, { actor, recordedAt, eventType, reason, evidenceRefs });
        return requireObligation(t, id);
      });
    },

    async setRetentionDisposition(id, { actor, recordedAt, reason, disposition }) {
      assertRetentionDisposition(disposition);
      // Transition metadata is validated here AND inside the guarded
      // function (TB224); the function appends the RETENTION_DECIDED event
      // in its own transaction (fix round 3, TBP1-002C) — the adapter no
      // longer inserts a duplicate event.
      assertNonEmptyString(actor, "actor");
      assertUtcIso(recordedAt, "recordedAt");
      assertNonEmptyString(reason, "reason");
      return tx(async (t) => {
        await requireObligation(t, id, { forUpdate: true });
        try {
          await t.query("select team_brain.tb_set_retention_disposition($1, $2, $3, $4, $5)", [
            id,
            disposition,
            actor,
            reason,
            recordedAt,
          ]);
        } catch (err) {
          mapGuardError(err, CODES.ILLEGAL_STATE_TRANSITION);
        }
        return requireObligation(t, id);
      });
    },

    async recordVerification(id, { verifier, verifiedAt, reason, evidenceRefs = [] }) {
      assertNonEmptyString(verifier, "verifier");
      assertStringArray(evidenceRefs, "evidenceRefs");
      if (evidenceRefs.length === 0) {
        fail(CODES.MISSING_EVIDENCE, `Verification for task ${id} requires non-empty evidence references`, { id });
      }
      return tx(async (t) => {
        const ob = await requireObligation(t, id, { forUpdate: true });
        requireKind(ob, "TASK", CODES.NOT_A_TASK);
        requireOpen(ob);
        await insertEvent(t, id, {
          actor: verifier,
          recordedAt: verifiedAt,
          eventType: "VERIFICATION",
          reason,
          evidenceRefs,
        });
        return requireObligation(t, id);
      });
    },

    async closeTask(id, { actor, recordedAt, reason, evidenceRefs = [] }) {
      assertStringArray(evidenceRefs, "evidenceRefs");
      // Transition metadata is validated here AND inside the guarded
      // function (TB224); the function appends the CLOSED event in its own
      // transaction (fix round 3, TBP1-002C) — the adapter no longer
      // inserts a duplicate event.
      assertNonEmptyString(actor, "actor");
      assertUtcIso(recordedAt, "recordedAt");
      assertNonEmptyString(reason, "reason");
      return tx(async (t) => {
        const ob = await requireObligation(t, id, { forUpdate: true });
        requireKind(ob, "TASK", CODES.NOT_A_TASK);
        requireOpen(ob);
        if (evidenceRefs.length === 0) {
          fail(CODES.MISSING_EVIDENCE, `Task ${id} cannot close without completion-evidence references`, { id });
        }
        const verRes = await t.query(
          "select evidence_links from team_brain.obligation_events where obligation_id = $1 and event_type = 'VERIFICATION'",
          [id],
        );
        if (verRes.rows.length === 0) {
          fail(CODES.NO_VERIFICATION, `Task ${id} cannot close without a recorded verification event`, { id });
        }
        // Coverage mirrors the DB guard (TB223) exactly: only a JSON array
        // of valid reference strings (nonblank strings) contributes, and
        // malformed evidence fails closed here too — an unguarded
        // JSON.parse would either throw an untyped error or, for an
        // object payload, iterate its values as if they were refs.
        const verified = new Set();
        for (const r of verRes.rows) {
          let links;
          try {
            links = JSON.parse(r.evidence_links || "[]");
          } catch {
            fail(
              CODES.UNVERIFIED_EVIDENCE,
              `Task ${id} cannot close: verification evidence is not valid JSON`,
              { id },
            );
          }
          if (
            !Array.isArray(links) ||
            links.some((ref) => typeof ref !== "string" || ref.trim() === "")
          ) {
            fail(
              CODES.UNVERIFIED_EVIDENCE,
              `Task ${id} cannot close: verification evidence is not a JSON array of valid reference strings`,
              { id },
            );
          }
          for (const ref of links) verified.add(ref);
        }
        const uncovered = evidenceRefs.filter((ref) => !verified.has(ref));
        if (uncovered.length > 0) {
          fail(
            CODES.UNVERIFIED_EVIDENCE,
            `Task ${id} cannot close: evidence not covered by a recorded verification: ${uncovered.join(", ")}`,
            { id, uncovered },
          );
        }
        try {
          await t.query("select team_brain.tb_close_task($1, $2, $3, $4, $5)", [
            id,
            evidenceRefs,
            actor,
            reason,
            recordedAt,
          ]);
        } catch (err) {
          mapGuardError(err, CODES.NOT_A_TASK);
        }
        return requireObligation(t, id);
      });
    },

    async revokeAuthorization(id, { actor, recordedAt, reason }) {
      // Transition metadata is validated here AND inside the guarded
      // function (TB224); the function appends the REVOKED event in its own
      // transaction (fix round 3, TBP1-002C) — the adapter no longer
      // inserts a duplicate event.
      assertNonEmptyString(actor, "actor");
      assertUtcIso(recordedAt, "recordedAt");
      assertNonEmptyString(reason, "reason");
      return tx(async (t) => {
        const ob = await requireObligation(t, id, { forUpdate: true });
        requireKind(ob, "AUTHORIZATION", CODES.NOT_AN_AUTHORIZATION);
        requireOpen(ob);
        try {
          await t.query("select team_brain.tb_revoke_authorization($1, $2, $3, $4)", [
            id,
            actor,
            reason,
            recordedAt,
          ]);
        } catch (err) {
          mapGuardError(err, CODES.NOT_AN_AUTHORIZATION);
        }
        return requireObligation(t, id);
      });
    },

    async supersedeVerdict(oldId, newRecord, { actor, recordedAt, reason }) {
      return tx(async (t) => {
        const old = await requireObligation(t, oldId, { forUpdate: true });
        requireKind(old, "VERDICT", CODES.NOT_A_VERDICT);
        requireOpen(old);
        const oldHead = old.reviewedHead ?? (old.source && old.source.head);
        const newHead = newRecord.reviewedHead ?? (newRecord.source && newRecord.source.head);
        if (!newHead) {
          fail(CODES.SUPERSESSION_HEAD_MISSING, `Superseding verdict must bind a new reviewed head`, { oldId });
        }
        if (newHead === oldHead) {
          fail(CODES.SAME_HEAD_SUPERSESSION, `Verdict ${oldId} cannot be superseded at the same head ${oldHead}`, {
            oldId,
            head: oldHead,
          });
        }
        assertUtcIso(newRecord.filedAt, "newRecord.filedAt");
        if (utcIsoToMs(newRecord.filedAt, "newRecord.filedAt") <= utcIsoToMs(old.filedAt, "old filedAt")) {
          fail(
            CODES.STALE_VERDICT_SUPERSESSION,
            `Verdict ${oldId} cannot be superseded by a verdict that is not strictly newer`,
            { oldId, oldFiledAt: old.filedAt, newFiledAt: newRecord.filedAt },
          );
        }
        // Binding pre-check (the guarded DB function re-checks this as
        // TB207): the new verdict must bind the same resource repo/scope.
        const newRepo = newRecord.resourceRepo ?? (newRecord.source && newRecord.source.repo) ?? null;
        if (old.resourceRepo != null && newRepo != null && old.resourceRepo !== newRepo) {
          fail(
            CODES.SUPERSESSION_BINDING_MISMATCH,
            `Verdict ${oldId} is bound to repo ${old.resourceRepo}; superseding verdict binds ${newRepo}`,
            { oldId, oldRepo: old.resourceRepo, newRepo },
          );
        }
        const newScope = newRecord.resourceScope ?? null;
        if ((old.resourceScope ?? null) !== newScope) {
          fail(
            CODES.SUPERSESSION_BINDING_MISMATCH,
            `Verdict ${oldId} is bound to scope ${old.resourceScope}; superseding verdict binds ${newScope}`,
            { oldId, oldScope: old.resourceScope, newScope },
          );
        }
        const created = await fileObligationRow(
          t,
          { ...newRecord, kind: "VERDICT", supersedes: oldId },
          recordedAt,
          { verdictSupersession: true },
        );
        // The guarded function records the obligation_supersessions relation
        // and both immutable events, then flips the old verdict's state —
        // one privileged transaction, no adapter-side event surgery.
        try {
          await t.query("select team_brain.tb_supersede_verdict($1, $2, $3, $4, $5)", [
            oldId,
            created.id,
            actor,
            reason,
            recordedAt,
          ]);
        } catch (err) {
          mapGuardError(err, CODES.NOT_A_VERDICT);
        }
        return { old: await requireObligation(t, oldId), next: await requireObligation(t, created.id) };
      });
    },

    async correctEvidence(oldId, newRecord, { actor, recordedAt, reason }) {
      return tx(async (t) => {
        const old = await requireObligation(t, oldId, { forUpdate: true });
        requireKind(old, "EVIDENCE", CODES.NOT_EVIDENCE);
        // Prototype parity: the correction is filed WITH its supersession
        // link, recorded in obligation_supersessions by the guarded recorder.
        const created = await fileObligationRow(
          t,
          { ...newRecord, kind: "EVIDENCE", supersedes: oldId },
          recordedAt,
        );
        await insertEvent(t, oldId, {
          actor,
          recordedAt,
          eventType: "CORRECTION_FILED",
          reason,
          evidenceRefs: [],
          extra: { correctionId: created.id },
        });
        return { original: await requireObligation(t, oldId), correction: created };
      });
    },

    async queueSnapshot() {
      const obligations = await this.listObligations();
      const client = await pool.connect();
      try {
        const res = await client.query(
          `select obligation_id, event_type from team_brain.obligation_events
           where event_type in ('REPING_SENT', 'REPORT_TO_JASON_SENT')`,
        );
        const flags = new Map();
        for (const r of res.rows) {
          const f = flags.get(r.obligation_id) || { repingSent: false, reportSent: false };
          if (r.event_type === "REPING_SENT") f.repingSent = true;
          if (r.event_type === "REPORT_TO_JASON_SENT") f.reportSent = true;
          flags.set(r.obligation_id, f);
        }
        return obligations.map((o) => ({
          id: o.id,
          kind: o.kind,
          filedAt: o.filedAt,
          state: o.state,
          deps: o.dependencies,
          override: o.priorityOverride,
          repingSent: !!(flags.get(o.id) && flags.get(o.id).repingSent),
          reportSent: !!(flags.get(o.id) && flags.get(o.id).reportSent),
        }));
      } finally {
        client.release();
      }
    },
  };
}
