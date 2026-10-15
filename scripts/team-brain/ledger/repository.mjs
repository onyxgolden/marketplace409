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
  assertSourceBinding,
  assertStringArray,
  assertUniqueStringArray,
  assertUtcIso,
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

function rowToObligation(row) {
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
    dependencies: JSON.parse(row.dependencies || "[]"),
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
    return rowToObligation(row);
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

  async function hasEventType(runner, obligationId, eventType) {
    const res = await runner.query(
      "select 1 from team_brain_obligation_events where obligation_id = $1 and event_type = $2 limit 1",
      [obligationId, eventType],
    );
    return res.rows.length > 0;
  }

  async function fileObligationRow(runner, record, createdAt) {
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
    assertSourceBinding(source);
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
      // The superseded record must exist (referential integrity of the link).
      const target = await getRaw(runner, supersedes);
      if (!target) {
        fail(CODES.UNKNOWN_OBLIGATION, `Supersession target does not exist: ${supersedes}`, { id: supersedes });
      }
    }
    if (priorityOverride !== null && typeof priorityOverride !== "object") {
      fail(CODES.INVALID_FIELD, "priorityOverride must be an object when present", { id });
    }
    try {
      await runner.query(
        `insert into team_brain_obligations
           (obligation_id, kind, filed_at, source_repo, source_path, source_commit, source_blob,
            source_head, state, retention_disposition, dependencies, supersedes, priority_override, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10,$11,$12,$13)`,
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
          JSON.stringify(dependencies),
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

    async getObligation(id) {
      return tx((t) => requireObligation(t, id));
    },

    async listObligations() {
      const res = await db.query(
        "select * from team_brain_obligations order by filed_at asc, obligation_id asc",
      );
      return res.rows.map(rowToObligation);
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

    // Verification step for a task. Distinct from close: close requires a
    // prior VERIFICATION event, so "evidence but no verification" is rejected.
    async recordVerification(id, { verifier, verifiedAt, reason, evidenceRefs = [] }) {
      assertNonEmptyString(verifier, "verifier");
      assertStringArray(evidenceRefs, "evidenceRefs");
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

    // Close a task: requires >=1 completion-evidence reference AND a prior
    // VERIFICATION event. Atomic: state change and event in one transaction.
    async closeTask(id, { actor, recordedAt, reason, evidenceRefs = [] }) {
      assertStringArray(evidenceRefs, "evidenceRefs");
      return tx(async (t) => {
        const ob = await requireObligation(t, id);
        requireKind(ob, "TASK", CODES.NOT_A_TASK);
        requireOpen(ob);
        if (evidenceRefs.length === 0) {
          fail(CODES.MISSING_EVIDENCE, `Task ${id} cannot close without completion-evidence references`, { id });
        }
        if (!(await hasEventType(t, id, "VERIFICATION"))) {
          fail(CODES.NO_VERIFICATION, `Task ${id} cannot close without a recorded verification event`, { id });
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

    // Supersede a verdict with a newer verdict at a NEW head. Same-head
    // "supersession" is rejected; the old record is never rewritten.
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
        const created = await fileObligationRow(t, { ...newRecord, kind: "VERDICT", supersedes: oldId }, recordedAt);
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
