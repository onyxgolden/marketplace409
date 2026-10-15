// Team Brain slice 1 — durable obligation ledger repository (PGlite-backed).
//
// Guards encoded from the Jason-approved persistence contract:
//  - A task closes only on verified completion (completion-evidence refs + a
//    recorded verification event). Clock advancement never closes anything.
//  - An authorization stands until an explicit revocation event; there is no
//    expiry-by-clock and no TTL anywhere in this API.
//  - A verdict stands until a newer verdict at a NEW head supersedes it.
//  - Evidence is immutable; corrections append a replacement link.
//  - There is deliberately NO delete, NO expiry, and NO garbage-collection
//    method. Silent deletion and silent expiry are impossible by construction.
//
// All lifecycle transitions run inside one PGlite transaction.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CODES, fail, TeamBrainError } from "./errors.mjs";
import {
  assertNonEmptyString,
  assertOverrideStructure,
  assertSourceBinding,
  assertStringArray,
  assertUniqueStringArray,
  assertUtcIso,
  utcIsoToMs,
} from "./validation.mjs";

const KINDS = ["TASK", "AUTHORIZATION", "VERDICT", "EVIDENCE"];
const TERMINAL_STATES = ["CLOSED", "REVOKED", "SUPERSEDED"];

// Annotation event types: they record facts but never move lifecycle state.
// Lifecycle transitions are only reachable through the named guarded methods.
const ANNOTATION_EVENT_TYPES = ["NOTE", "REPING_SENT", "REPORT_TO_JASON_SENT"];

function migrationSql() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "migrations", "001_team_brain_schema.sql"), "utf8");
}

function rowToObligation(row, dependencies) {
  return {
    id: row.obligation_id,
    kind: row.kind,
    filedAt: row.filed_at,
    source: {
      repo: row.source_repo,
      path: row.source_path,
      commit: row.source_commit,
      blob: row.source_blob,
      head: row.source_head,
    },
    state: row.state,
    retentionDisposition: row.retention_disposition,
    dependencies: dependencies || [],
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    priorityOverride: row.priority_override ? JSON.parse(row.priority_override) : null,
    createdAt: row.created_at,
  };
}

export function createRepository(db) {
  async function tx(work) {
    if (typeof db.transaction === "function") {
      return db.transaction(async (t) => work(t));
    }
    // PGlite single-connection semantics: sequential awaits are effectively
    // atomic for the single-writer fixture/test usage of this slice.
    return work(db);
  }

  async function getRaw(runner, id) {
    const res = await runner.query(
      "select * from team_brain_obligations where obligation_id = $1",
      [id],
    );
    return res.rows[0] || null;
  }

  async function requireObligation(runner, id) {
    const row = await getRaw(runner, id);
    if (!row) {
      fail(CODES.UNKNOWN_OBLIGATION, `Unknown obligation: ${id}`, { id });
    }
    return rowToObligation(row, await getDependencyIds(runner, id));
  }

  // Dependency edges live in the normalized table; the FKs enforce
  // referential integrity and the CHECK refuses self-links at the schema.
  async function getDependencyIds(runner, id) {
    const res = await runner.query(
      "select depends_on_id from team_brain_obligation_dependencies where obligation_id = $1 order by depends_on_id asc",
      [id],
    );
    return res.rows.map((r) => r.depends_on_id);
  }

  async function insertDependencyEdges(runner, id, dependencies) {
    for (const dep of dependencies) {
      await runner.query(
        "insert into team_brain_obligation_dependencies (obligation_id, depends_on_id) values ($1, $2)",
        [id, dep],
      );
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

  async function insertEvent(runner, obligationId, { actor, recordedAt, eventType, reason, evidenceRefs = [], extra = {} }) {
    assertNonEmptyString(actor, "actor");
    assertUtcIso(recordedAt, "recordedAt");
    assertNonEmptyString(reason, "reason");
    assertStringArray(evidenceRefs, "evidenceRefs");
    await runner.query(
      `insert into team_brain_obligation_events
         (obligation_id, actor, recorded_at, event_type, reason, evidence_refs, extra)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        obligationId,
        actor,
        recordedAt,
        eventType,
        reason,
        JSON.stringify(evidenceRefs),
        JSON.stringify(extra),
      ],
    );
  }

  async function fileObligationRow(runner, record, createdAt, internal = {}) {
    const {
      id,
      kind,
      filedAt,
      source,
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
    // Every verdict must bind an exact reviewed head; a verdict without one
    // is not a verdict the ledger can reason about.
    assertSourceBinding(source, { requireHead: kind === "VERDICT" });
    assertNonEmptyString(retentionDisposition, "retentionDisposition");
    assertUniqueStringArray(dependencies, "dependencies");
    if (dependencies.includes(id)) {
      fail(CODES.SELF_DEPENDENCY, `Obligation ${id} may not depend on itself`, { id });
    }
    if (supersedes !== null) {
      assertNonEmptyString(supersedes, "supersedes");
      if (supersedes === id) {
        fail(CODES.SELF_SUPERSESSION, `Obligation ${id} may not supersede itself`, { id });
      }
      // Verdict supersession links are only creatable through the guarded
      // supersedeVerdict transaction. A generic filing that smuggles one in
      // would leave both records OPEN with a contradictory link.
      if (kind === "VERDICT" && !internal.verdictSupersession) {
        fail(
          CODES.UNGUARDED_VERDICT_SUPERSESSION,
          `Verdict ${id} may not be filed with a supersession link; use supersedeVerdict`,
          { id, supersedes },
        );
      }
      // The superseded record must exist (referential integrity of the link).
      const target = await getRaw(runner, supersedes);
      if (!target) {
        fail(CODES.UNKNOWN_OBLIGATION, `Supersession target does not exist: ${supersedes}`, { id: supersedes });
      }
    }
    // Write-boundary override validation: malformed overrides (including
    // free-text self-attested authority) are rejected here so they can never
    // be persisted to poison later queue reads. Trust resolution against
    // Jason authorization records happens in the queue projection.
    if (priorityOverride !== null) {
      assertOverrideStructure(priorityOverride, id);
    }
    try {
      await runner.query(
        `insert into team_brain_obligations
           (obligation_id, kind, filed_at, source_repo, source_path, source_commit, source_blob,
            source_head, state, retention_disposition, supersedes, priority_override, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10,$11,$12)`,
        [
          id,
          kind,
          filedAt,
          source.repo,
          source.path,
          source.commit ?? null,
          source.blob ?? null,
          source.head ?? null,
          retentionDisposition,
          supersedes,
          priorityOverride ? JSON.stringify(priorityOverride) : null,
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
    // Dependency edges: the FK to team_brain_obligations enforces that every
    // dependency names a real obligation; the CHECK refuses self-links. For a
    // single filing, unknown dependencies are rejected here with a typed
    // error. A batch filing (allowForwardRefs) may reference obligations
    // filed later in the same transaction; the deferred FK lands at commit.
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
    await insertEvent(runner, id, {
      actor: record.filedBy || "system",
      recordedAt: filedAt,
      eventType: "FILED",
      reason: record.filedReason || "obligation filed",
      evidenceRefs: [],
      extra: { kind },
    });
    return requireObligation(runner, id);
  }

  return {
    // Apply the versioned migration. Idempotent (IF NOT EXISTS / upsert).
    async migrate() {
      await db.exec(migrationSql());
    },

    // File a new obligation. Filing never moves any other record's state.
    async fileObligation(record, createdAt) {
      return tx((t) => fileObligationRow(t, record, createdAt || record.filedAt));
    },

    // File multiple obligations atomically. Forward references (A depends on
    // B filed later in the same batch) are permitted; the deferred FK
    // validates the complete graph at commit. A single filing with an unknown
    // dependency still fails.
    async fileObligationBatch(records, createdAt) {
      if (!Array.isArray(records) || records.length === 0) {
        fail(CODES.INVALID_FIELD, "fileObligationBatch requires a non-empty array of records", {});
      }
      return tx(async (t) => {
        const created = [];
        for (const record of records) {
          created.push(
            await fileObligationRow(t, record, createdAt || record.filedAt, { allowForwardRefs: true }),
          );
        }
        return created;
      });
    },

    async getObligation(id) {
      return tx((t) => requireObligation(t, id));
    },

    async listObligations() {
      const res = await db.query("select * from team_brain_obligations order by filed_at asc, obligation_id asc");
      const depRes = await db.query(
        "select obligation_id, depends_on_id from team_brain_obligation_dependencies order by obligation_id asc, depends_on_id asc",
      );
      const depMap = new Map();
      for (const r of depRes.rows) {
        if (!depMap.has(r.obligation_id)) depMap.set(r.obligation_id, []);
        depMap.get(r.obligation_id).push(r.depends_on_id);
      }
      return res.rows.map((row) => rowToObligation(row, depMap.get(row.obligation_id) || []));
    },

    async getEvents(id) {
      await tx((t) => requireObligation(t, id));
      const res = await db.query(
        "select * from team_brain_obligation_events where obligation_id = $1 order by seq asc",
        [id],
      );
      return res.rows.map((r) => ({
        seq: r.seq,
        obligationId: r.obligation_id,
        actor: r.actor,
        recordedAt: r.recorded_at,
        eventType: r.event_type,
        reason: r.reason,
        evidenceRefs: JSON.parse(r.evidence_refs || "[]"),
        extra: JSON.parse(r.extra || "{}"),
      }));
    },

    // Annotation events: NOTE / REPING_SENT / REPORT_TO_JASON_SENT.
    // These record facts; they never move lifecycle state.
    async appendAnnotation(id, { actor, recordedAt, eventType, reason, evidenceRefs = [] }) {
      if (!ANNOTATION_EVENT_TYPES.includes(eventType)) {
        fail(CODES.ILLEGAL_STATE_TRANSITION, `Event type ${eventType} is not an annotation; lifecycle transitions require the guarded methods`, {
          id,
          eventType,
        });
      }
      return tx(async (t) => {
        await requireObligation(t, id);
        await insertEvent(t, id, { actor, recordedAt, eventType, reason, evidenceRefs });
        return requireObligation(t, id);
      });
    },

    // Explicit retention decision. There is no silent expiry path.
    async setRetentionDisposition(id, { actor, recordedAt, reason, disposition }) {
      assertNonEmptyString(disposition, "disposition");
      return tx(async (t) => {
        await requireObligation(t, id);
        await t.query(
          "update team_brain_obligations set retention_disposition = $1 where obligation_id = $2",
          [disposition, id],
        );
        await insertEvent(t, id, {
          actor,
          recordedAt,
          eventType: "RETENTION_DECIDED",
          reason,
          evidenceRefs: [],
          extra: { disposition },
        });
        return requireObligation(t, id);
      });
    },

    // Verification step for a task. Binds the verified evidence references;
    // empty evidence is rejected here so an empty verification can never
    // satisfy a close. Distinct from close: close requires the closing
    // evidence to be covered by recorded VERIFICATION events.
    async recordVerification(id, { verifier, verifiedAt, reason, evidenceRefs = [] }) {
      assertNonEmptyString(verifier, "verifier");
      assertStringArray(evidenceRefs, "evidenceRefs");
      if (evidenceRefs.length === 0) {
        fail(CODES.MISSING_EVIDENCE, `Verification for task ${id} requires non-empty evidence references`, { id });
      }
      return tx(async (t) => {
        const ob = await requireObligation(t, id);
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

    // Close a task: requires >=1 completion-evidence reference AND every
    // closing reference to be covered by a recorded VERIFICATION event's
    // evidence. The coverage check is atomic with the state change: a
    // verification for evidence-A cannot close evidence-B, and an empty
    // verification can never satisfy a close.
    async closeTask(id, { actor, recordedAt, reason, evidenceRefs = [] }) {
      assertStringArray(evidenceRefs, "evidenceRefs");
      return tx(async (t) => {
        const ob = await requireObligation(t, id);
        requireKind(ob, "TASK", CODES.NOT_A_TASK);
        requireOpen(ob);
        if (evidenceRefs.length === 0) {
          fail(CODES.MISSING_EVIDENCE, `Task ${id} cannot close without completion-evidence references`, { id });
        }
        const verRes = await t.query(
          "select evidence_refs from team_brain_obligation_events where obligation_id = $1 and event_type = 'VERIFICATION'",
          [id],
        );
        if (verRes.rows.length === 0) {
          fail(CODES.NO_VERIFICATION, `Task ${id} cannot close without a recorded verification event`, { id });
        }
        const verified = new Set();
        for (const r of verRes.rows) {
          for (const ref of JSON.parse(r.evidence_refs || "[]")) verified.add(ref);
        }
        const uncovered = evidenceRefs.filter((ref) => !verified.has(ref));
        if (uncovered.length > 0) {
          fail(
            CODES.UNVERIFIED_EVIDENCE,
            `Task ${id} cannot close: evidence not covered by a recorded verification: ${uncovered.join(", ")}`,
            { id, uncovered },
          );
        }
        await t.query("update team_brain_obligations set state = 'CLOSED' where obligation_id = $1", [id]);
        await insertEvent(t, id, {
          actor,
          recordedAt,
          eventType: "CLOSED",
          reason,
          evidenceRefs,
        });
        return requireObligation(t, id);
      });
    },

    // Revoke an authorization. The ONLY way an authorization stops being
    // effective; clock advancement is not consulted anywhere in this module.
    async revokeAuthorization(id, { actor, recordedAt, reason }) {
      return tx(async (t) => {
        const ob = await requireObligation(t, id);
        requireKind(ob, "AUTHORIZATION", CODES.NOT_AN_AUTHORIZATION);
        requireOpen(ob);
        await t.query("update team_brain_obligations set state = 'REVOKED' where obligation_id = $1", [id]);
        await insertEvent(t, id, {
          actor,
          recordedAt,
          eventType: "REVOKED",
          reason,
          evidenceRefs: [],
        });
        return requireObligation(t, id);
      });
    },

    // Supersede a verdict with a NEWER verdict at a NEW head. Same-head
    // "supersession" is rejected, and so is a superseding verdict that is not
    // strictly newer by filed time. The old record is never rewritten.
    async supersedeVerdict(oldId, newRecord, { actor, recordedAt, reason }) {
      return tx(async (t) => {
        const old = await requireObligation(t, oldId);
        requireKind(old, "VERDICT", CODES.NOT_A_VERDICT);
        requireOpen(old);
        const oldHead = old.source.head;
        const newHead = newRecord.source && newRecord.source.head;
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
        const created = await fileObligationRow(
          t,
          { ...newRecord, kind: "VERDICT", supersedes: oldId },
          recordedAt,
          { verdictSupersession: true },
        );
        await t.query(
          "update team_brain_obligations set state = 'SUPERSEDED', superseded_by = $1 where obligation_id = $2",
          [created.id, oldId],
        );
        await insertEvent(t, oldId, {
          actor,
          recordedAt,
          eventType: "SUPERSEDED",
          reason,
          evidenceRefs: [],
          extra: { supersededBy: created.id, newHead },
        });
        return { old: await requireObligation(t, oldId), next: created };
      });
    },

    // Correct evidence: file a replacement record linked to the original.
    // The original record's fields and events are never rewritten.
    async correctEvidence(oldId, newRecord, { actor, recordedAt, reason }) {
      return tx(async (t) => {
        const old = await requireObligation(t, oldId);
        requireKind(old, "EVIDENCE", CODES.NOT_EVIDENCE);
        const created = await fileObligationRow(t, { ...newRecord, kind: "EVIDENCE", supersedes: oldId }, recordedAt);
        await t.query("update team_brain_obligations set superseded_by = $1 where obligation_id = $2", [created.id, oldId]);
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

    // Read helper for the queue projection: one row per obligation with the
    // action-event flags the escalation logic needs.
    async queueSnapshot() {
      const obligations = await this.listObligations();
      const res = await db.query(
        `select obligation_id, event_type from team_brain_obligation_events
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
    },
  };
}
