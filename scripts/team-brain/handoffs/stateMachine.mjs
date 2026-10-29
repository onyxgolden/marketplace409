// Team Brain slice 1 — transaction-gated handoff state machine.
//
// OPEN -> OUTCOME_WRITTEN -> READBACK_VERIFIED -> QUEUE_UPDATED -> COMPLETE
//
// Every transition is one PGlite transaction that writes the new state and
// appends an event row together. Skipped, reordered, duplicate-conflicting,
// or stale-binding transitions are rejected without partial state. An exact
// replay of an already-applied transition returns the existing state without
// appending a second event. A crash between transitions recovers the last
// committed state; completion is never inferred from chat text.
//
// Slice 1 proves the gating logic with synthetic references only. It writes
// no live GitHub result and no live tracker.

import { CODES, fail } from "../ledger/errors.mjs";
import {
  artifactBindingsEqual,
  assertArtifactBinding,
  assertNonEmptyString,
  assertUtcIso,
} from "../ledger/validation.mjs";

const STATES = ["OPEN", "OUTCOME_WRITTEN", "READBACK_VERIFIED", "QUEUE_UPDATED", "COMPLETE"];
const NEXT = {
  OPEN: "OUTCOME_WRITTEN",
  OUTCOME_WRITTEN: "READBACK_VERIFIED",
  READBACK_VERIFIED: "QUEUE_UPDATED",
  QUEUE_UPDATED: "COMPLETE",
  COMPLETE: null,
};

function rowToHandoff(row) {
  return {
    id: row.handoff_id,
    state: row.state,
    artifact:
      row.artifact_commit == null
        ? null
        : {
            repo: row.artifact_repo,
            path: row.artifact_path,
            commit: row.artifact_commit,
            blob: row.artifact_blob,
            head: row.artifact_head,
          },
    queue:
      row.queue_commit == null
        ? null
        : {
            repo: row.queue_repo,
            path: row.queue_path,
            commit: row.queue_commit,
            blob: row.queue_blob,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createHandoffMachine(db) {
  async function tx(work) {
    if (typeof db.transaction === "function") {
      return db.transaction(async (t) => work(t));
    }
    return work(db);
  }

  async function getRaw(runner, id) {
    const res = await runner.query("select * from team_brain_handoffs where handoff_id = $1", [id]);
    return res.rows[0] || null;
  }

  async function requireHandoff(runner, id) {
    const row = await getRaw(runner, id);
    if (!row) fail(CODES.UNKNOWN_HANDOFF, `Unknown handoff: ${id}`, { id });
    return rowToHandoff(row);
  }

  async function recordEvent(runner, id, { from, to, actor, recordedAt, reason, artifact, queue }) {
    await runner.query(
      `insert into team_brain_handoff_events
         (handoff_id, from_state, to_state, actor, recorded_at, reason,
          artifact_repo, artifact_path, artifact_commit, artifact_blob, artifact_head,
          queue_repo, queue_path, queue_commit, queue_blob)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        from,
        to,
        actor,
        recordedAt,
        reason,
        artifact ? artifact.repo : null,
        artifact ? artifact.path : null,
        artifact ? artifact.commit : null,
        artifact ? artifact.blob : null,
        artifact ? artifact.head : null,
        queue ? queue.repo : null,
        queue ? queue.path : null,
        queue ? queue.commit : null,
        queue ? queue.blob : null,
      ],
    );
  }

  // Field-by-field comparison of a recorded binding against a requested one.
  // Both null is a match; a null on one side only is a mismatch. Every
  // pointer field participates: repository and path are identity, never
  // decoration — comparing hashes alone would accept a retry that swaps the
  // repository or path while reusing the same content hashes.
  function bindingsMatch(recorded, requested, fields) {
    if (recorded == null && requested == null) return true;
    if (recorded == null || requested == null) return false;
    return fields.every((f) => recorded[f] === requested[f]);
  }

  // Does a committed step event exactly match the requested step identity?
  // A step's identity is its target state plus the COMPLETE transition
  // identity: recorded actor, recorded time, recorded reason, and the full
  // artifact binding (repo/path/commit/blob/head) and queue binding
  // (repo/path/commit/blob) where the step carries them. Anything less is
  // not an exact replay.
  function stepEventMatches(ev, { actor, recordedAt, reason, artifact, queue }) {
    if (ev.actor !== actor) return false;
    if (ev.recorded_at !== recordedAt) return false;
    if (ev.reason !== reason) return false;
    if (
      !bindingsMatch(
        ev.artifact_repo == null
          ? null
          : {
              repo: ev.artifact_repo,
              path: ev.artifact_path,
              commit: ev.artifact_commit,
              blob: ev.artifact_blob,
              head: ev.artifact_head,
            },
        artifact,
        ["repo", "path", "commit", "blob", "head"],
      )
    ) {
      return false;
    }
    if (
      !bindingsMatch(
        ev.queue_repo == null
          ? null
          : {
              repo: ev.queue_repo,
              path: ev.queue_path,
              commit: ev.queue_commit,
              blob: ev.queue_blob,
            },
        queue,
        ["repo", "path", "commit", "blob"],
      )
    ) {
      return false;
    }
    return true;
  }

  // Core guarded transition. `apply` mutates the row columns for the step.
  //
  // Idempotent replay: if the requested step (target state + complete step
  // identity: actor, recorded time, reason, full artifact and queue
  // bindings) exactly matches a committed step event, the current state is
  // returned without appending a second event — even when later transitions
  // have since advanced the handoff. A retry after subsequent committed
  // progress is recognized from history, never mistaken for a new transition.
  //
  // Conflicting replay: if the step was committed with a different identity
  // in ANY field — a swapped repository or path with reused hashes, a new
  // recorded time or reason, a different actor — the replay is rejected
  // atomically: no state change, no event appended. The queue binding is
  // compared as well as the artifact binding, so a queue update that claims
  // a new tracker commit cannot masquerade as idempotent.
  async function transition(id, to, { actor, recordedAt, reason, artifact, queue, apply }) {
    assertNonEmptyString(actor, "actor");
    assertUtcIso(recordedAt, "recordedAt");
    assertNonEmptyString(reason, "reason");
    return tx(async (t) => {
      const handoff = await requireHandoff(t, id);
      const from = handoff.state;
      // The step identity mirrors exactly what recordEvent persists below:
      // steps that carry no binding in the request inherit the handoff's
      // current binding (which is what gets recorded).
      const stepIdentity = {
        actor,
        recordedAt,
        reason,
        artifact: artifact || handoff.artifact || null,
        queue: queue || null,
      };
      const stepEvents = await t.query(
        "select * from team_brain_handoff_events where handoff_id = $1 and to_state = $2 order by seq asc",
        [id, to],
      );
      let exactReplay = false;
      let conflictingReplay = false;
      for (const ev of stepEvents.rows) {
        if (stepEventMatches(ev, stepIdentity)) {
          exactReplay = true;
          break;
        }
        conflictingReplay = true;
      }
      if (exactReplay) {
        return handoff; // idempotent: no second event appended
      }
      if (conflictingReplay) {
        fail(
          CODES.CONFLICTING_REPLAY,
          `Conflicting replay of ${id} step ${to}: bindings or attribution differ from the committed step`,
          { id, to },
        );
      }
      if (NEXT[from] !== to) {
        fail(CODES.SKIPPED_TRANSITION, `Handoff ${id} cannot move ${from} -> ${to}; expected ${NEXT[from]}`, {
          id,
          from,
          to,
        });
      }
      await apply(t, handoff);
      await recordEvent(t, id, { from, to, actor, recordedAt, reason, artifact: artifact || handoff.artifact, queue });
      return requireHandoff(t, id);
    });
  }

  return {
    // Begin a handoff in OPEN. Re-beginning an existing id is idempotent.
    async beginHandoff(id, { actor, recordedAt, reason }) {
      assertNonEmptyString(id, "handoff id");
      assertNonEmptyString(actor, "actor");
      assertUtcIso(recordedAt, "recordedAt");
      assertNonEmptyString(reason, "reason");
      return tx(async (t) => {
        const existing = await getRaw(t, id);
        if (existing) return rowToHandoff(existing);
        await t.query(
          `insert into team_brain_handoffs (handoff_id, state, created_at, updated_at)
           values ($1, 'OPEN', $2, $2)`,
          [id, recordedAt],
        );
        await recordEvent(t, id, { from: "OPEN", to: "OPEN", actor, recordedAt, reason });
        return requireHandoff(t, id);
      });
    },

    async getHandoff(id) {
      return tx((t) => requireHandoff(t, id));
    },

    async listHandoffs() {
      const res = await db.query("select * from team_brain_handoffs order by handoff_id asc");
      return res.rows.map(rowToHandoff);
    },

    async getEvents(id) {
      await tx((t) => requireHandoff(t, id));
      const res = await db.query(
        "select * from team_brain_handoff_events where handoff_id = $1 order by seq asc",
        [id],
      );
      return res.rows;
    },

    // Step 1: durable outcome reference + exact artifact commit/blob/head.
    // Chat-only "done" text without an artifact binding is rejected.
    async writeOutcome(id, { actor, recordedAt, reason, artifact }) {
      assertArtifactBinding(artifact, CODES.MISSING_ARTIFACT_BINDING);
      return transition(id, "OUTCOME_WRITTEN", {
        actor,
        recordedAt,
        reason,
        artifact,
        apply: async (t) => {
          await t.query(
            `update team_brain_handoffs set
               state = 'OUTCOME_WRITTEN',
               artifact_repo = $2, artifact_path = $3, artifact_commit = $4,
               artifact_blob = $5, artifact_head = $6, updated_at = $7
             where handoff_id = $1`,
            [id, artifact.repo, artifact.path, artifact.commit, artifact.blob, artifact.head, recordedAt],
          );
        },
      });
    },

    // Step 2: readback must bind the EXACT artifact written in step 1.
    // A changed SHA/blob/head is rejected as stale.
    async verifyReadback(id, { verifier, verifiedAt, reason, artifact }) {
      assertArtifactBinding(artifact, CODES.MISSING_ARTIFACT_BINDING);
      assertNonEmptyString(verifier, "verifier");
      return transition(id, "READBACK_VERIFIED", {
        actor: verifier,
        recordedAt: verifiedAt,
        reason,
        artifact,
        apply: async (t, handoff) => {
          if (!artifactBindingsEqual(handoff.artifact, artifact)) {
            fail(CODES.STALE_BINDING, `Handoff ${id}: readback artifact binding does not match the written outcome`, {
              id,
              written: handoff.artifact,
              readback: artifact,
            });
          }
          await t.query(
            "update team_brain_handoffs set state = 'READBACK_VERIFIED', updated_at = $2 where handoff_id = $1",
            [id, verifiedAt],
          );
        },
      });
    },

    // Step 3: the queue/tracker update must be durable before completion.
    async updateQueue(id, { actor, recordedAt, reason, queue }) {
      if (!queue || typeof queue !== "object") {
        fail(CODES.MISSING_QUEUE_EVIDENCE, `Handoff ${id}: queue update requires a durable queue reference`, { id });
      }
      for (const field of ["repo", "path", "commit", "blob"]) {
        if (typeof queue[field] !== "string" || queue[field].trim() === "") {
          fail(CODES.MISSING_QUEUE_EVIDENCE, `Handoff ${id}: queue reference missing ${field}`, { id, field });
        }
      }
      return transition(id, "QUEUE_UPDATED", {
        actor,
        recordedAt,
        reason,
        queue,
        apply: async (t) => {
          await t.query(
            `update team_brain_handoffs set
               state = 'QUEUE_UPDATED',
               queue_repo = $2, queue_path = $3, queue_commit = $4, queue_blob = $5, updated_at = $6
             where handoff_id = $1`,
            [id, queue.repo, queue.path, queue.commit, queue.blob, recordedAt],
          );
        },
      });
    },

    // Step 4: allowed only when the three prior states exist in order and all
    // artifact bindings still agree. Never inferred from caller claims.
    //
    // TBP4-001A: `fenceCheck`, when given, is invoked synchronously as the
    // very last step before the COMPLETE write below, with no `await`
    // between that check and the write it guards. Every step above it in
    // this transition (`requireHandoff`, the replay-event select, this
    // step's own event-chain select) crosses an `await`, any one of which
    // a concurrent rebind could land in; a caller-side preflight check run
    // before calling this function cannot see a rebind that happens during
    // those awaits. Re-validating here, synchronously adjacent to the
    // actual state-mutating statement, closes that window completely:
    // nothing can run between this check and the dispatch of the write it
    // guards, since JS only yields at an `await`.
    async completeHandoff(id, { actor, recordedAt, reason, fenceCheck }) {
      return transition(id, "COMPLETE", {
        actor,
        recordedAt,
        reason,
        apply: async (t, handoff) => {
          if (handoff.state !== "QUEUE_UPDATED") {
            fail(CODES.SKIPPED_TRANSITION, `Handoff ${id}: completion requires QUEUE_UPDATED`, {
              id,
              state: handoff.state,
            });
          }
          if (!handoff.artifact || !handoff.queue) {
            fail(CODES.BINDING_MISMATCH, `Handoff ${id}: artifact and queue bindings must both be present to complete`, {
              id,
            });
          }
          // Verify the event chain is exactly the four ordered transitions.
          const events = await t.query(
            "select from_state, to_state from team_brain_handoff_events where handoff_id = $1 order by seq asc",
            [id],
          );
          const chain = events.rows.map((r) => `${r.from_state}->${r.to_state}`);
          const expected = [
            "OPEN->OPEN",
            "OPEN->OUTCOME_WRITTEN",
            "OUTCOME_WRITTEN->READBACK_VERIFIED",
            "READBACK_VERIFIED->QUEUE_UPDATED",
          ];
          if (JSON.stringify(chain) !== JSON.stringify(expected)) {
            fail(CODES.BINDING_MISMATCH, `Handoff ${id}: event chain is not the ordered four-step chain`, {
              id,
              chain,
            });
          }
          // TBP4-001A: last synchronous check before the write it guards -
          // see the comment on completeHandoff above.
          if (typeof fenceCheck === "function") fenceCheck();
          await t.query("update team_brain_handoffs set state = 'COMPLETE', updated_at = $2 where handoff_id = $1", [
            id,
            recordedAt,
          ]);
        },
      });
    },
  };
}

export { STATES };
