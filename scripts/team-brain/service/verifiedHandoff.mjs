// Team Brain slice 4 — verified end-to-end handoffs.
//
// This driver composes the reviewed slice-1 handoff state machine and
// the reviewed slice-3 coordination outbox into the brief Section 5
// chain, replacing caller attestation with independently produced
// evidence at every step:
//
//   OPEN -> OUTCOME_WRITTEN -> READBACK_VERIFIED -> QUEUE_UPDATED -> COMPLETE
//
//   1. publishOutcome: one immutable outcome path per operation, written
//      through the outbox with expected-blob CAS and an operation_id
//      stamp. A retry reuses the same path and intent; a changed intent
//      is a conflicting replay, never a second result path.
//   2. verifyReadback: an INDEPENDENT Git read (a separate adapter from
//      the writer) fetches the pinned commit/path bytes; the blob is
//      recomputed here and compared byte-for-byte. No caller claim is
//      accepted: there is no `verified` input.
//   3. recordQueueAnswer: the queue export is itself an outbox delivery,
//      read back independently, and bound into a revisioned queue
//      receipt (handoff + outcome + queue Git identity + row versions)
//      BEFORE the state machine advances to QUEUE_UPDATED.
//   4. completeVerified: rechecks outcome, readback, queue receipt,
//      provenance, head currency, and the row-version chain, and only
//      then appends COMPLETE and closes the bound queue item. Any gap
//      refuses with zero closes.
//   5. reconcile: restart recovery from any intermediate state, driven
//      by Git truth and outbox state. Same identity/content resumes;
//      divergent content halts as CONFLICTING_REPLAY; unknown states
//      are reported, never guessed.
//
// Two-system atomicity, stated honestly: the brief itself says this is
// a durable state machine across two systems, NOT a distributed atomic
// transaction (Section 5). P4 achieves COMPLETE+close safety by
// validate-before-apply inside one driver call, plus idempotent
// reconcile: a crash between the machine's COMPLETE commit and the
// ledger close is re-applied from the COMPLETE event, and a crash
// before COMPLETE leaves the handoff QUEUE_UPDATED for a clean retry.
// No step ever closes on an unverified claim.
//
// The driver owns no clock, no network, and no send adapter. Git access
// comes from the host-injected `git` adapter (read/head/write); task
// records come from the host-owned slice-3 controller list; the receipt
// ledger is a plain JSON-serializable object the host persists across
// restarts (a fresh driver over the same ledger IS a restart).
//
// Worker fencing: a driver instance is one worker (workerId + monotonic
// generation). A mutation from an older generation, or from a different
// worker at the same generation, is refused as STALE_WORKER. A strictly
// greater generation takes over and rebinds. A restart of the same
// worker at the same generation proceeds.

import { gitBlobSha1, sha256Hex, assertFullHex40, assertFullArtifactBinding } from "./gitIdentity.mjs";
import { createIndependentReadback } from "./readback.mjs";
import { CODES, P3_CODES, P4_CODES, fail } from "./errors.mjs";
import { assertNonEmptyString, assertUtcIso, utcIsoToMs } from "../ledger/validation.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import {
  enqueueOutbox,
  claimOutbox,
  recordDelivery,
  taskApplicabilityToken,
  DEFAULT_ALLOWED_REPOS,
  DEFAULT_ALLOWED_PATH_PREFIXES,
} from "../orchestrator/outbox.mjs";

const TERMINAL_TASK_STATUSES = new Set(["DONE", "ESCALATED"]);

// JSON-serializable receipt/binding ledger. The host persists this
// object; nothing in it is a live handle, so a restart restores it
// exactly. `revision` is a global monotonic counter bumped on every
// ledger mutation, so a host can detect a stale ledger copy.
export function createHandoffLedger() {
  return {
    bindings: {},
    outcomeReceipts: {},
    readbackReceipts: {},
    queueReceipts: [],
    queueItems: {},
    revision: 0,
  };
}

function artifactEquals(a, b) {
  if (!a || !b) return false;
  return ["repo", "path", "commit", "blob", "head"].every((f) => a[f] === b[f]);
}

function latestQueueReceiptForHandoff(ledger, handoffId) {
  const receipts = ledger.queueReceipts.filter((r) => r.handoffId === handoffId);
  return receipts.length > 0 ? receipts[receipts.length - 1] : null;
}

function latestQueueReceiptForKey(ledger, key) {
  const receipts = ledger.queueReceipts.filter((r) => r.queueItemKey === key);
  return receipts.length > 0 ? receipts[receipts.length - 1] : null;
}

export function createVerifiedHandoffDriver({
  handoffs,
  git,
  outboxEntries,
  ledger = createHandoffLedger(),
  workerId,
  generation = 1,
  provenanceFor = null,
  allowedRepos = DEFAULT_ALLOWED_REPOS,
  allowedPathPrefixes = DEFAULT_ALLOWED_PATH_PREFIXES,
} = {}) {
  if (!handoffs || typeof handoffs.beginHandoff !== "function") {
    fail(P4_CODES.INCOMPLETE_EVIDENCE, "Verified handoff driver requires a slice-1 handoff machine", {});
  }
  if (!git || typeof git.read !== "function" || typeof git.write !== "function" || typeof git.head !== "function") {
    fail(P4_CODES.READBACK_UNAVAILABLE, "Verified handoff driver requires a git adapter with read, write, and head", {});
  }
  if (!outboxEntries || !Array.isArray(outboxEntries.entries)) {
    fail(P4_CODES.INCOMPLETE_EVIDENCE, "Verified handoff driver requires an outbox entries holder { entries: [] }", {});
  }
  assertNonEmptyString(workerId, "driver.workerId");
  if (!Number.isInteger(generation) || generation < 1) {
    fail(P4_CODES.STALE_WORKER, `Driver generation must be a positive integer, got ${generation}`, { generation });
  }

  const readback = createIndependentReadback({ git });

  function queueItemKeyFor(binding) {
    return binding.taskId ? `task:${binding.taskId}` : `handoff:${binding.handoffId}`;
  }

  // Fencing: allowed iff this generation is strictly greater (takeover,
  // rebinds) or equal with the same workerId (same worker, including a
  // restart). Anything else is a stale worker and refuses.
  function checkFencing(binding) {
    if (!binding) return;
    if (generation < binding.generation) {
      fail(P4_CODES.STALE_WORKER, `Stale worker ${workerId} generation ${generation} behind bound generation ${binding.generation}`, {
        workerId,
        generation,
        boundWorkerId: binding.workerId,
        boundGeneration: binding.generation,
      });
    }
    if (generation === binding.generation && workerId !== binding.workerId) {
      fail(P4_CODES.STALE_WORKER, `Worker ${workerId} at generation ${generation} does not own handoff bound to ${binding.workerId}`, {
        workerId,
        generation,
        boundWorkerId: binding.workerId,
        boundGeneration: binding.generation,
      });
    }
    if (generation > binding.generation || workerId !== binding.workerId) {
      binding.workerId = workerId;
      binding.generation = generation;
      ledger.revision += 1;
    }
  }

  function requireBinding(handoffId) {
    const binding = ledger.bindings[handoffId];
    if (!binding) {
      fail(CODES.UNKNOWN_HANDOFF, `No verified-handoff binding for ${handoffId}; call beginVerified first`, { id: handoffId });
    }
    return binding;
  }

  function checkProvenance(binding, artifact) {
    if (!provenanceFor) {
      fail(P4_CODES.PROVENANCE_MISSING, `No provenance adapter wired for handoff ${binding.handoffId}; missing provenance blocks closure`, {
        handoffId: binding.handoffId,
      });
    }
    const result = provenanceFor({ handoffId: binding.handoffId, taskId: binding.taskId ?? null, artifact });
    if (!result || result.status == null) {
      fail(P4_CODES.PROVENANCE_MISSING, `Provenance status missing for handoff ${binding.handoffId}`, {
        handoffId: binding.handoffId,
      });
    }
    if (result.status !== "VERIFIED") {
      fail(P4_CODES.PROVENANCE_UNVERIFIED, `Provenance for handoff ${binding.handoffId} is ${result.status}, not VERIFIED`, {
        handoffId: binding.handoffId,
        status: result.status,
      });
    }
  }

  function findOutboxEntry(operationId) {
    return outboxEntries.entries.find((e) => e.operationId === operationId) || null;
  }

  function findDeliveredOutcomeEntry(handoffId) {
    return (
      outboxEntries.entries.find(
        (e) =>
          e.state === "DELIVERED" &&
          e.payload &&
          typeof e.payload === "object" &&
          e.payload.handoffId === handoffId &&
          typeof e.payload.operationId === "string",
      ) || null
    );
  }

  // A delivery established by reading back identical bytes, not by a
  // write reply: used when a write's reply was lost. The receipt is
  // explicit about what was observed (head, blob) and what was not
  // (the prior blob is the claimed expectation, flagged as unobserved).
  function markReconciledDelivery(entry, { newBlob, head }) {
    const receipt = {
      operationId: entry.operationId,
      targetRepo: entry.targetRepo,
      targetPath: entry.targetPath,
      priorBlob: entry.expectedPriorBlob,
      priorBlobObserved: false,
      newBlob,
      head,
      payloadHash: entry.payloadHash,
      deliveredAt: entry.createdAt,
      method: "RECONCILED_READBACK",
    };
    const next = { ...entry, state: "DELIVERED", lease: null, deliveryReceipt: receipt, lastError: null };
    outboxEntries.entries = outboxEntries.entries.map((e) => (e.operationId === entry.operationId ? next : e));
    return { entry: next, receipt };
  }

  // Shared write path for outcome and queue-export intents. Returns the
  // delivery receipt. Throws DELIVERY_UNKNOWN when the write may or may
  // not have landed (lost reply); throws CAS_CONFLICT when the expected
  // prior blob is stale (entry stays CLAIMED for revalidation); throws
  // GIT_UNAVAILABLE only when the transport refused before writing, so
  // an immediate retry is safe.
  //
  // Lost-reply guard, before writing: after claiming, read the path at
  // the current head. If it already holds exactly the intended bytes,
  // a previous attempt's write landed and its reply was lost — the
  // delivery is reconciled, never written twice.
  //
  // `writeBytes` defaults to the canonical payload bytes (the outcome
  // envelope). A queue export overrides it: the queue path in Git must
  // hold the actual export content, while the outbox payload is the
  // intent record that embeds those bytes plus their hash. Writing the
  // wrapper instead of the export would make the queue readback — which
  // compares Git bytes against the export — fail on every run.
  async function deliverThroughOutbox({ operationId, targetRepo, targetPath, expectedPriorBlob, payload, createdAt, tasks, sourceTaskId = null, sourceTaskRevision = null, writeBytes = null }) {
    const enqueued = enqueueOutbox(
      outboxEntries.entries,
      {
        operationId,
        targetRepo,
        targetPath,
        expectedPriorBlob,
        payload,
        createdAt,
        ...(sourceTaskId ? { sourceTaskId, sourceTaskRevision } : {}),
      },
      { allowedRepos, allowedPathPrefixes },
    );
    outboxEntries.entries = enqueued.entries;
    let entry = enqueued.entry;
    if (entry.state === "DELIVERED") {
      return { entry, receipt: entry.deliveryReceipt, resumed: true };
    }
    const claimed = claimOutbox({ entries: outboxEntries.entries, operationId, owner: workerId, now: createdAt, tasks: tasks ?? null });
    outboxEntries.entries = claimed.entries;
    entry = claimed.entry;
    if (claimed.alreadyDelivered) {
      return { entry, receipt: entry.deliveryReceipt, resumed: true };
    }
    const bytes = writeBytes !== null ? writeBytes : stableStringify(payload);
    try {
      const currentHead = await git.head(targetRepo);
      const observed = await git.read({ repo: targetRepo, commit: currentHead, path: targetPath });
      if (observed.bytes === bytes) {
        const reconciled = markReconciledDelivery(entry, { newBlob: gitBlobSha1(bytes), head: currentHead });
        return { entry: reconciled.entry, receipt: reconciled.receipt, resumed: true };
      }
    } catch (error) {
      // Absent path (NOT_FOUND) means not yet written: proceed to the
      // write, whose CAS arbitrates. Unavailable transport: proceed
      // too; the write will surface the same failure honestly.
      if (error && error.code !== P4_CODES.GIT_NOT_FOUND && error.code !== P4_CODES.GIT_UNAVAILABLE) throw error;
    }
    let gitResponse;
    try {
      gitResponse = await git.write({ repo: targetRepo, path: targetPath, expectedPriorBlob, bytes });
    } catch (error) {
      if (error && error.code === P4_CODES.GIT_CAS_CONFLICT) {
        fail(P3_CODES.CAS_CONFLICT, `Git CAS conflict writing ${targetRepo}/${targetPath} for ${operationId}: expected prior ${expectedPriorBlob} no longer current`, {
          operationId,
          targetRepo,
          targetPath,
          expectedPriorBlob,
        });
      }
      if (error && error.code === P4_CODES.GIT_UNAVAILABLE) throw error;
      fail(P4_CODES.DELIVERY_UNKNOWN, `Outcome write outcome unknown for ${operationId}: ${error && error.message ? error.message : String(error)}`, {
        operationId,
        originalCode: error && error.code ? error.code : null,
      });
    }
    assertFullHex40(gitResponse.newBlob, "gitResponse.newBlob");
    assertFullHex40(gitResponse.head, "gitResponse.head");
    const recorded = recordDelivery({
      entries: outboxEntries.entries,
      operationId,
      owner: workerId,
      generation: claimed.lease.generation,
      gitResponse,
      now: createdAt,
      tasks: tasks ?? null,
    });
    outboxEntries.entries = recorded.entries;
    if (recorded.refused) {
      fail(P3_CODES.CAS_CONFLICT, `Git delivery refused for ${operationId}: prior blob ${recorded.refused.priorBlob} differs from expected ${recorded.refused.expectedPriorBlob}; entry stays CLAIMED`, {
        operationId,
        expectedPriorBlob: recorded.refused.expectedPriorBlob,
        priorBlob: recorded.refused.priorBlob,
      });
    }
    if (recorded.alreadyDelivered) {
      return { entry: recorded.entry, receipt: recorded.receipt, resumed: true };
    }
    return { entry: recorded.entry, receipt: recorded.receipt, resumed: false };
  }

  // Resume a DELIVERED outbox entry into a handoff transition + receipt
  // without writing again. The bytes at the delivered head must equal
  // the admitted intent bytes exactly; anything else is divergent, not
  // a resume.
  async function finishDeliveredOutcome({ binding, operationId, actor, recordedAt, reason }) {
    const entry = findOutboxEntry(operationId);
    if (!entry || entry.state !== "DELIVERED" || !entry.deliveryReceipt) {
      fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `No delivered outbox entry for ${operationId} to resume`, { operationId });
    }
    const envelope = entry.payload;
    if (!envelope || envelope.handoffId !== binding.handoffId || envelope.operationId !== operationId) {
      fail(CODES.CONFLICTING_REPLAY, `Delivered outbox entry ${operationId} does not belong to handoff ${binding.handoffId}`, {
        operationId,
        handoffId: binding.handoffId,
      });
    }
    const expectedBytes = stableStringify(envelope);
    const delivery = entry.deliveryReceipt;
    assertFullArtifactBinding({
      repo: delivery.targetRepo,
      path: delivery.targetPath,
      commit: delivery.head,
      blob: delivery.newBlob,
      head: delivery.head,
    });
    let observed;
    try {
      observed = await git.read({ repo: delivery.targetRepo, commit: delivery.head, path: delivery.targetPath });
    } catch (error) {
      if (error && error.code === P4_CODES.GIT_NOT_FOUND) {
        fail(P4_CODES.READBACK_MISMATCH, `Delivered outcome ${operationId} is absent at its delivered head ${delivery.head}`, {
          operationId,
          head: delivery.head,
        });
      }
      throw error;
    }
    if (observed.bytes !== expectedBytes || gitBlobSha1(observed.bytes) !== delivery.newBlob) {
      fail(CODES.CONFLICTING_REPLAY, `Delivered outcome ${operationId} bytes diverge from the admitted intent; refusing to resume`, {
        operationId,
      });
    }
    const artifact = {
      repo: delivery.targetRepo,
      path: delivery.targetPath,
      commit: delivery.head,
      blob: delivery.newBlob,
      head: delivery.head,
    };
    const handoff = await handoffs.writeOutcome(binding.handoffId, { actor, recordedAt, reason, artifact });
    const receipt = {
      operationId,
      handoffId: binding.handoffId,
      artifact,
      payloadHash: entry.payloadHash,
      envelopeSha256: sha256Hex(expectedBytes),
      contentSha256: envelope.contentSha256,
      // TBP4-003: carry the same audit-identity fields publishOutcome's
      // own receipt does, so a later replay against *this* receipt gets
      // the same complete-identity comparison, not a weaker one just
      // because this particular receipt was built via the
      // delivered-but-not-yet-receipted recovery path.
      expectedPriorBlob: delivery.priorBlob,
      actor,
      reason,
      deliveredAt: recordedAt,
      deliveryMethod: delivery.method || "outbox-resumed",
      outboxReceipt: delivery,
    };
    ledger.outcomeReceipts[binding.handoffId] = receipt;
    ledger.revision += 1;
    return { handoff, receipt };
  }

  function boundTaskRecord(binding, tasks) {
    if (!binding.taskId) return null;
    const task = (tasks || []).find((t) => t.id === binding.taskId);
    if (!task) {
      fail(P4_CODES.UNKNOWN_TASK_BINDING, `Bound task ${binding.taskId} is not in the supplied task collection`, {
        handoffId: binding.handoffId,
        taskId: binding.taskId,
      });
    }
    return task;
  }

  function checkTaskStillBound(binding, task) {
    if (!task) return;
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      fail(P4_CODES.TASK_TERMINAL, `Bound task ${task.id} is ${task.status}; the handoff close cannot proceed around it`, {
        taskId: task.id,
        status: task.status,
      });
    }
    if (
      task.snapshotRevision !== binding.boundTask.snapshotRevision ||
      task.assignmentEpoch !== binding.boundTask.assignmentEpoch
    ) {
      fail(P4_CODES.TASK_MOVED, `Bound task ${task.id} moved since binding (snapshot/epoch changed); refusing to close on stale binding`, {
        taskId: task.id,
        boundSnapshotRevision: binding.boundTask.snapshotRevision,
        currentSnapshotRevision: task.snapshotRevision,
        boundAssignmentEpoch: binding.boundTask.assignmentEpoch,
        currentAssignmentEpoch: task.assignmentEpoch,
      });
    }
  }

  return {
    getLedger() {
      return ledger;
    },

    getBinding(handoffId) {
      return ledger.bindings[handoffId] || null;
    },

    getReceipts(handoffId) {
      const binding = ledger.bindings[handoffId] || null;
      return {
        binding,
        outcome: ledger.outcomeReceipts[handoffId] || null,
        readbacks: [...(ledger.readbackReceipts[handoffId] || [])],
        queueReceipts: ledger.queueReceipts.filter((r) => r.handoffId === handoffId),
        queueItem: binding ? ledger.queueItems[queueItemKeyFor(binding)] || null : null,
      };
    },

    // Bind a handoff to its queue item and owning worker. Re-beginning
    // with the identical binding is idempotent (and may rebind the
    // worker on a strictly greater generation); a different task or
    // task snapshot is a conflicting replay.
    async beginVerified({ handoffId, taskId = null, taskSnapshot = null, actor, recordedAt, reason }) {
      assertNonEmptyString(handoffId, "beginVerified.handoffId");
      assertNonEmptyString(actor, "beginVerified.actor");
      assertUtcIso(recordedAt, "beginVerified.recordedAt");
      assertNonEmptyString(reason, "beginVerified.reason");
      if (taskId !== null) {
        assertNonEmptyString(taskId, "beginVerified.taskId");
        if (!taskSnapshot || !Number.isInteger(taskSnapshot.snapshotRevision) || !Number.isInteger(taskSnapshot.assignmentEpoch)) {
          fail(P4_CODES.UNKNOWN_TASK_BINDING, `Task-bound handoff ${handoffId} requires a task snapshot (snapshotRevision, assignmentEpoch)`, {
            handoffId,
            taskId,
          });
        }
      }
      const existing = ledger.bindings[handoffId];
      if (existing) {
        // Field-wise comparison, not JSON string comparison: key order
        // in the host's snapshot object must not decide identity.
        const sameBinding =
          existing.taskId === taskId &&
          (existing.boundTask === null
            ? taskSnapshot === null
            : taskSnapshot !== null &&
              existing.boundTask.snapshotRevision === taskSnapshot.snapshotRevision &&
              existing.boundTask.assignmentEpoch === taskSnapshot.assignmentEpoch);
        if (!sameBinding) {
          fail(CODES.CONFLICTING_REPLAY, `Handoff ${handoffId} already bound to a different task/snapshot`, {
            handoffId,
          });
        }
        checkFencing(existing);
        const handoff = await handoffs.beginHandoff(handoffId, { actor, recordedAt, reason });
        return { handoff, binding: existing, replayed: true };
      }
      const binding = {
        handoffId,
        taskId,
        boundTask: taskSnapshot ? { ...taskSnapshot } : null,
        workerId,
        generation,
      };
      ledger.bindings[handoffId] = binding;
      ledger.revision += 1;
      const handoff = await handoffs.beginHandoff(handoffId, { actor, recordedAt, reason });
      return { handoff, binding, replayed: false };
    },

    // Publish one immutable outcome. The stored bytes are the canonical
    // envelope { operationId, handoffId, content, contentSha256 }, so
    // the operation stamp is structural and a retry reproduces identical
    // bytes. A lost reply (DELIVERY_UNKNOWN) leaves the outbox entry
    // CLAIMED and the handoff OPEN: reconcile, never blind retry, and
    // never assume the write failed.
    async publishOutcome({ handoffId, operationId, content, targetRepo, targetPath, expectedPriorBlob, actor, recordedAt, reason }) {
      const binding = requireBinding(handoffId);
      checkFencing(binding);
      assertNonEmptyString(operationId, "publishOutcome.operationId");
      assertNonEmptyString(actor, "publishOutcome.actor");
      assertUtcIso(recordedAt, "publishOutcome.recordedAt");
      assertNonEmptyString(reason, "publishOutcome.reason");
      assertNonEmptyString(expectedPriorBlob, "publishOutcome.expectedPriorBlob");
      assertFullHex40(expectedPriorBlob, "publishOutcome.expectedPriorBlob");
      const contentSha256 = sha256Hex(stableStringify(content));
      const existingReceipt = ledger.outcomeReceipts[handoffId];
      if (existingReceipt) {
        // TBP4-003: a replay must match the *complete* immutable
        // operation identity, not just operation id/content/destination
        // — expectedPriorBlob and the audit parameters (actor,
        // recordedAt, reason) are part of what the caller is claiming
        // happened, and a fast-path replay must never be weaker than
        // the normal CAS-checked write path at accepting a materially
        // different claim under the same operation id.
        if (
          existingReceipt.operationId === operationId &&
          existingReceipt.contentSha256 === contentSha256 &&
          existingReceipt.artifact.repo === targetRepo &&
          existingReceipt.artifact.path === targetPath &&
          existingReceipt.expectedPriorBlob === expectedPriorBlob &&
          existingReceipt.actor === actor &&
          existingReceipt.deliveredAt === recordedAt &&
          existingReceipt.reason === reason
        ) {
          const handoff = await handoffs.getHandoff(handoffId);
          return { handoff, receipt: existingReceipt, replayed: true };
        }
        fail(CODES.CONFLICTING_REPLAY, `Handoff ${handoffId} already has an outcome for a different operation/content/destination/audit-identity`, {
          handoffId,
          operationId,
        });
      }
      const envelope = { operationId, handoffId, content, contentSha256 };
      const existingEntry = findOutboxEntry(operationId);
      if (existingEntry && existingEntry.state === "DELIVERED") {
        // Crash after delivery, before writeOutcome/receipt store:
        // resume from the delivery receipt without writing again.
        return { ...(await finishDeliveredOutcome({ binding, operationId, actor, recordedAt, reason })), replayed: false };
      }
      const { receipt: deliveryReceipt } = await deliverThroughOutbox({
        operationId,
        targetRepo,
        targetPath,
        expectedPriorBlob,
        payload: envelope,
        createdAt: recordedAt,
        tasks: null,
      });
      const artifact = {
        repo: deliveryReceipt.targetRepo,
        path: deliveryReceipt.targetPath,
        commit: deliveryReceipt.head,
        blob: deliveryReceipt.newBlob,
        head: deliveryReceipt.head,
      };
      assertFullArtifactBinding(artifact);
      const handoff = await handoffs.writeOutcome(handoffId, { actor, recordedAt, reason, artifact });
      const receipt = {
        operationId,
        handoffId,
        artifact,
        payloadHash: findOutboxEntry(operationId).payloadHash,
        envelopeSha256: sha256Hex(stableStringify(envelope)),
        contentSha256,
        expectedPriorBlob,
        actor,
        reason,
        deliveredAt: recordedAt,
        deliveryMethod: "outbox",
        outboxReceipt: deliveryReceipt,
      };
      ledger.outcomeReceipts[handoffId] = receipt;
      ledger.revision += 1;
      return { handoff, receipt, replayed: false };
    },

    // Advance to READBACK_VERIFIED on an independently produced receipt
    // only. A caller `verified` field is refused, not ignored. A stored
    // receipt with identical identity replays idempotently; a stored
    // receipt with different identity conflicts; a state already past
    // READBACK_VERIFIED with no stored receipt re-establishes evidence
    // by a fresh independent read (marked reestablished) without
    // re-advancing state.
    async verifyReadback({ handoffId, verifier, checkedAt, reason, ...rest }) {
      const binding = requireBinding(handoffId);
      checkFencing(binding);
      if (rest.verified !== undefined) {
        fail(P4_CODES.INVALID_READBACK_CLAIM, "Readback refuses a caller-supplied verified claim; verification comes only from an independent Git read", {
          handoffId,
        });
      }
      assertNonEmptyString(verifier, "verifyReadback.verifier");
      assertUtcIso(checkedAt, "verifyReadback.checkedAt");
      assertNonEmptyString(reason, "verifyReadback.reason");
      const handoff = await handoffs.getHandoff(handoffId);
      const receipts = ledger.readbackReceipts[handoffId] || [];
      if (receipts.length > 0) {
        const latest = receipts[receipts.length - 1];
        if (!artifactEquals(latest.artifact, handoff.artifact)) {
          fail(P4_CODES.READBACK_MISMATCH, `Stored readback receipt for ${handoffId} does not match the handoff's written artifact`, {
            handoffId,
          });
        }
        if (latest.verifier === verifier && latest.checkedAt === checkedAt && latest.reason === reason) {
          return { handoff, receipt: latest, replayed: true };
        }
        fail(CODES.CONFLICTING_REPLAY, `Readback for ${handoffId} already recorded with a different verifier/time/reason`, {
          handoffId,
        });
      }
      if (handoff.state === "OPEN") {
        fail(CODES.SKIPPED_TRANSITION, `Handoff ${handoffId} cannot verify readback from OPEN; publish an outcome first`, {
          id: handoffId,
          state: handoff.state,
        });
      }
      const outcomeReceipt = ledger.outcomeReceipts[handoffId];
      if (!outcomeReceipt) {
        fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `Handoff ${handoffId} has no outcome receipt; readback has nothing to verify against`, {
          handoffId,
        });
      }
      assertFullArtifactBinding(handoff.artifact);
      if (handoff.artifact.commit !== handoff.artifact.head) {
        fail(CODES.BINDING_MISMATCH, `Handoff ${handoffId} outcome commit ${handoff.artifact.commit} does not equal its head ${handoff.artifact.head}; P4 outcomes are pinned to the commit that wrote them`, {
          handoffId,
        });
      }
      checkProvenance(binding, handoff.artifact);
      const outboxEntry = findOutboxEntry(outcomeReceipt.operationId);
      if (!outboxEntry) {
        fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `Outbox intent for outcome ${outcomeReceipt.operationId} is missing; cannot reconstruct intended bytes`, {
          handoffId,
          operationId: outcomeReceipt.operationId,
        });
      }
      const expectedBytes = stableStringify(outboxEntry.payload);
      const receipt = await readback.verifyBytes({
        repo: handoff.artifact.repo,
        commit: handoff.artifact.commit,
        path: handoff.artifact.path,
        expectedBytes,
        expectedBlob: handoff.artifact.blob,
        verifier,
        checkedAt,
        reason,
        expectedRecordedAt: handoff.updatedAt,
      });
      receipt.artifact = { ...handoff.artifact };
      receipt.handoffId = handoffId;
      let nextHandoff = handoff;
      if (handoff.state === "OUTCOME_WRITTEN") {
        nextHandoff = await handoffs.verifyReadback(handoffId, {
          verifier,
          verifiedAt: checkedAt,
          reason,
          artifact: handoff.artifact,
        });
      } else {
        // State already past READBACK_VERIFIED: this fresh independent
        // read repairs missing evidence only; it never re-advances
        // state and never rewrites history.
        receipt.reestablished = true;
      }
      ledger.readbackReceipts[handoffId] = [...receipts, receipt];
      ledger.revision += 1;
      return { handoff: nextHandoff, receipt, replayed: false };
    },

    // Record the queue answer (ANSWER_RECORDED_PENDING_CLOSE) and
    // advance to QUEUE_UPDATED. The queue export is delivered through
    // the outbox and read back independently BEFORE the state advance,
    // and the receipt binds handoff + outcome + queue Git identity +
    // row versions. This state is explicitly NOT complete: completion
    // still requires completeVerified.
    async recordQueueAnswer({
      handoffId,
      taskId = null,
      queueOperationId,
      queueExportBytes,
      targetRepo,
      targetPath,
      expectedPriorBlob,
      actor,
      recordedAt,
      reason,
      verifier = null,
      tasks = null,
    }) {
      const binding = requireBinding(handoffId);
      checkFencing(binding);
      assertNonEmptyString(queueOperationId, "recordQueueAnswer.queueOperationId");
      assertNonEmptyString(actor, "recordQueueAnswer.actor");
      assertUtcIso(recordedAt, "recordQueueAnswer.recordedAt");
      assertNonEmptyString(reason, "recordQueueAnswer.reason");
      assertNonEmptyString(expectedPriorBlob, "recordQueueAnswer.expectedPriorBlob");
      assertFullHex40(expectedPriorBlob, "recordQueueAnswer.expectedPriorBlob");
      if (typeof queueExportBytes !== "string" || queueExportBytes.length === 0) {
        fail(P4_CODES.QUEUE_RECEIPT_MISMATCH, "Queue answer requires nonempty queue export bytes", { handoffId });
      }
      const handoff = await handoffs.getHandoff(handoffId);
      if (handoff.state !== "READBACK_VERIFIED" && handoff.state !== "QUEUE_UPDATED") {
        fail(CODES.SKIPPED_TRANSITION, `Handoff ${handoffId} cannot record a queue answer from ${handoff.state}; readback must verify first`, {
          id: handoffId,
          state: handoff.state,
        });
      }
      // Task binding: the queue answer closes THIS task, so a moved or
      // terminal task refuses here, before any Git write.
      let task = null;
      if (binding.taskId) {
        if (taskId !== binding.taskId) {
          fail(P4_CODES.UNKNOWN_TASK_BINDING, `Queue answer for ${handoffId} names task ${taskId ?? "none"}, bound task is ${binding.taskId}`, {
            handoffId,
            taskId,
          });
        }
        task = boundTaskRecord(binding, tasks);
        checkTaskStillBound(binding, task);
      } else if (taskId !== null) {
        fail(P4_CODES.UNKNOWN_TASK_BINDING, `Handoff ${handoffId} is not task-bound but the queue answer names task ${taskId}`, {
          handoffId,
          taskId,
        });
      }
      const existingReceipt = ledger.queueReceipts.find(
        (r) => r.handoffId === handoffId && r.queueOperationId === queueOperationId,
      );
      const preEntry = findOutboxEntry(queueOperationId);
      // TBP4-003: the same complete-identity comparison publishOutcome
      // now requires — bytes alone is not the full claim a replay makes;
      // expectedPriorBlob, destination, and the audit parameters (actor,
      // recordedAt, reason) must also match, or this is a conflicting
      // replay, not an idempotent one.
      if (
        existingReceipt &&
        handoff.state === "QUEUE_UPDATED" &&
        preEntry &&
        preEntry.state === "DELIVERED" &&
        preEntry.payload.exportBytes === queueExportBytes &&
        existingReceipt.queue.repo === targetRepo &&
        existingReceipt.queue.path === targetPath &&
        existingReceipt.expectedPriorBlob === expectedPriorBlob &&
        existingReceipt.actor === actor &&
        existingReceipt.issuedAt === recordedAt &&
        existingReceipt.reason === reason
      ) {
        return { handoff, queueReceipt: existingReceipt, replayed: true };
      }
      // TBP4-003A: deliverThroughOutbox's own replay gate below only
      // compares *content* identity (export bytes, destination,
      // expectedPriorBlob, task binding) - it has no idea this call also
      // claims an audit identity (actor/recordedAt/reason). If content
      // still matches a previously delivered receipt exactly but the
      // audit identity is the only thing that changed (the full-identity
      // check above didn't return, so something differs), falling
      // through would let deliverThroughOutbox "resume" the already-
      // delivered entry and a new receipt get written carrying the
      // changed audit identity - silently accepting an audit-only replay
      // mismatch instead of refusing it. Catch that case explicitly,
      // before the fall-through, rather than widening
      // deliverThroughOutbox's shared conflict gate (other callers rely
      // on its current, narrower content-only comparison).
      if (
        existingReceipt &&
        handoff.state === "QUEUE_UPDATED" &&
        preEntry &&
        preEntry.state === "DELIVERED" &&
        preEntry.payload.exportBytes === queueExportBytes &&
        existingReceipt.queue.repo === targetRepo &&
        existingReceipt.queue.path === targetPath &&
        existingReceipt.expectedPriorBlob === expectedPriorBlob
      ) {
        fail(CODES.CONFLICTING_REPLAY, `Queue answer for ${queueOperationId} already recorded with a different actor/time/reason`, {
          handoffId,
          queueOperationId,
        });
      }
      // Identity didn't fully match (or there's no existing receipt
      // yet): fall through to the normal path below, same as before -
      // deliverThroughOutbox/enqueueOutbox is the actual conflict gate
      // for a different-bytes replay of the same operation id; this
      // block only decides whether the *fast-path* shortcut applies,
      // never whether a conflict exists.
      const outcomeReceipt = ledger.outcomeReceipts[handoffId];
      if (!outcomeReceipt) {
        fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `Handoff ${handoffId} has no outcome receipt to bind into a queue receipt`, {
          handoffId,
        });
      }
      const payload = binding.taskId
        ? { handoffId, taskId: binding.taskId, exportSha256: sha256Hex(queueExportBytes), exportBytes: queueExportBytes }
        : { handoffId, exportSha256: sha256Hex(queueExportBytes), exportBytes: queueExportBytes };
      // The enqueue inside deliverThroughOutbox is the replay gate: a
      // replayed operation with different bytes or a different task
      // binding conflicts there, before any write. A DELIVERED entry
      // resumes without writing again, but only when the delivered
      // bytes equal this call's export bytes.
      const delivered = await deliverThroughOutbox({
        operationId: queueOperationId,
        targetRepo,
        targetPath,
        expectedPriorBlob,
        payload,
        writeBytes: queueExportBytes,
        createdAt: recordedAt,
        tasks: binding.taskId ? tasks : null,
        ...(binding.taskId
          ? { sourceTaskId: binding.taskId, sourceTaskRevision: taskApplicabilityToken(task) }
          : {}),
      });
      if (delivered.resumed) {
        const resumedEntry = findOutboxEntry(queueOperationId);
        if (!resumedEntry || resumedEntry.payload.exportBytes !== queueExportBytes) {
          fail(CODES.CONFLICTING_REPLAY, `Queue export ${queueOperationId} already delivered with different bytes`, {
            queueOperationId,
          });
        }
      }
      const deliveryReceipt = delivered.receipt;
      const queueBinding = {
        repo: deliveryReceipt.targetRepo,
        path: deliveryReceipt.targetPath,
        commit: deliveryReceipt.head,
        blob: deliveryReceipt.newBlob,
      };
      assertFullArtifactBinding({ ...queueBinding, head: queueBinding.commit });
      // Independent readback of the queue export BEFORE QUEUE_UPDATED:
      // the receipt binds the Git identity the read actually observed.
      const queueReadback = await readback.verifyBytes({
        repo: queueBinding.repo,
        commit: queueBinding.commit,
        path: queueBinding.path,
        expectedBytes: queueExportBytes,
        expectedBlob: queueBinding.blob,
        verifier: verifier || workerId,
        checkedAt: recordedAt,
        reason,
      }).catch((error) => {
        if (error && error.code === P4_CODES.READBACK_MISMATCH) {
          fail(P4_CODES.QUEUE_RECEIPT_MISMATCH, `Queue export readback mismatch for ${handoffId}: ${error.message}`, {
            handoffId,
            queueOperationId,
          });
        }
        throw error;
      });
      const nextHandoff = await handoffs.updateQueue(handoffId, { actor, recordedAt, reason, queue: queueBinding });
      const key = queueItemKeyFor(binding);
      const priorItem = ledger.queueItems[key];
      const queueItemRowVersion = (priorItem ? priorItem.rowVersion : 0) + 1;
      const queueRevision = (latestQueueReceiptForKey(ledger, key)?.queueRevision || 0) + 1;
      const queueReceipt = {
        receiptId: `qr-${sha256Hex(stableStringify({ handoffId, queueOperationId, queueBinding, queueRevision })).slice(0, 24)}`,
        handoffId,
        taskId: binding.taskId,
        queueOperationId,
        queueItemKey: key,
        outcome: { ...outcomeReceipt.artifact },
        queue: { ...queueBinding },
        taskSnapshotRevision: task ? task.snapshotRevision : null,
        queueItemRowVersion,
        queueRevision,
        queueReadbackReceiptId: queueReadback.receiptId,
        // TBP4-003: carried so a later replay attempt can be compared
        // against the complete original claim, not just export bytes.
        expectedPriorBlob,
        actor,
        reason,
        issuedAt: recordedAt,
        status: "ANSWER_RECORDED_PENDING_CLOSE",
      };
      ledger.queueReceipts.push(queueReceipt);
      ledger.queueItems[key] = {
        key,
        taskId: binding.taskId,
        boundHandoffId: handoffId,
        status: "ANSWER_RECORDED_PENDING_CLOSE",
        rowVersion: queueItemRowVersion,
        lastQueueReceiptId: queueReceipt.receiptId,
      };
      ledger.revision += 1;
      return { handoff: nextHandoff, queueReceipt, replayed: false };
    },

    // COMPLETE + close. Rechecks every receipt, provenance, head
    // currency, and the row-version chain before mutating anything;
    // any gap refuses with zero closes. A moved head with the outcome
    // intact recovers by a fresh readback at the new head; a moved head
    // with the outcome gone refuses as STALE_HEAD.
    async completeVerified({ handoffId, actor, recordedAt, reason, tasks = null }) {
      const binding = requireBinding(handoffId);
      checkFencing(binding);
      assertNonEmptyString(actor, "completeVerified.actor");
      assertUtcIso(recordedAt, "completeVerified.recordedAt");
      assertNonEmptyString(reason, "completeVerified.reason");
      let handoff = await handoffs.getHandoff(handoffId);
      if (handoff.state === "COMPLETE") {
        const events = await handoffs.getEvents(handoffId);
        const completeEvent = events.find((e) => e.to_state === "COMPLETE");
        if (
          completeEvent &&
          completeEvent.actor === actor &&
          completeEvent.recorded_at === recordedAt &&
          completeEvent.reason === reason
        ) {
          const key = queueItemKeyFor(binding);
          return { handoff, queueItem: ledger.queueItems[key] || null, tasks, replayed: true };
        }
        fail(CODES.CONFLICTING_REPLAY, `Handoff ${handoffId} already completed with a different actor/time/reason`, {
          handoffId,
        });
      }
      if (handoff.state !== "QUEUE_UPDATED") {
        fail(CODES.SKIPPED_TRANSITION, `Handoff ${handoffId} cannot complete from ${handoff.state}; a queue answer must be recorded first`, {
          id: handoffId,
          state: handoff.state,
        });
      }
      const outcomeReceipt = ledger.outcomeReceipts[handoffId];
      if (!outcomeReceipt) {
        fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `Handoff ${handoffId} cannot complete without an outcome receipt`, { handoffId });
      }
      const readbacks = ledger.readbackReceipts[handoffId] || [];
      if (readbacks.length === 0) {
        fail(P4_CODES.READBACK_RECEIPT_MISSING, `Handoff ${handoffId} cannot complete without a readback receipt`, { handoffId });
      }
      const queueReceipt = latestQueueReceiptForHandoff(ledger, handoffId);
      if (!queueReceipt || queueReceipt.status !== "ANSWER_RECORDED_PENDING_CLOSE") {
        fail(P4_CODES.QUEUE_RECEIPT_MISSING, `Handoff ${handoffId} cannot complete without a pending-close queue receipt`, {
          handoffId,
        });
      }
      // The queue receipt must bind THIS handoff, THIS outcome, and
      // THIS task. A receipt carried over from another handoff or task
      // is a mismatch, never a close.
      if (!artifactEquals(queueReceipt.outcome, handoff.artifact) || queueReceipt.taskId !== binding.taskId) {
        fail(P4_CODES.QUEUE_RECEIPT_MISMATCH, `Queue receipt for ${handoffId} does not bind this handoff's outcome/task`, {
          handoffId,
          receiptOutcome: queueReceipt.outcome,
          handoffArtifact: handoff.artifact,
          receiptTaskId: queueReceipt.taskId,
          boundTaskId: binding.taskId,
        });
      }
      checkProvenance(binding, handoff.artifact);
      if (utcIsoToMs(recordedAt, "completeVerified.recordedAt") < utcIsoToMs(queueReceipt.issuedAt, "queueReceipt.issuedAt")) {
        fail(P4_CODES.TIME_ORDER, `Complete recordedAt ${recordedAt} precedes queue receipt issuedAt ${queueReceipt.issuedAt}`, {
          handoffId,
          recordedAt,
          issuedAt: queueReceipt.issuedAt,
        });
      }
      // Head currency: the outcome must still be present. A moved head
      // with identical outcome bytes recovers by re-readback; anything
      // else refuses without closing.
      const outcomeEntry = findOutboxEntry(outcomeReceipt.operationId);
      if (!outcomeEntry) {
        fail(P4_CODES.OUTCOME_RECEIPT_MISSING, `Outbox intent for outcome ${outcomeReceipt.operationId} is missing at complete time`, {
          handoffId,
          operationId: outcomeReceipt.operationId,
        });
      }
      const expectedOutcomeBytes = stableStringify(outcomeEntry.payload);
      let currentHead;
      try {
        currentHead = await git.head(outcomeReceipt.artifact.repo);
      } catch (error) {
        if (error && error.code === P4_CODES.GIT_UNAVAILABLE) throw error;
        fail(P4_CODES.GIT_UNAVAILABLE, `Cannot establish current head for ${outcomeReceipt.artifact.repo}: ${error.message}`, {
          repo: outcomeReceipt.artifact.repo,
        });
      }
      assertFullHex40(currentHead, "git.head");
      if (currentHead !== outcomeReceipt.artifact.head) {
        let observed;
        try {
          observed = await git.read({ repo: outcomeReceipt.artifact.repo, commit: currentHead, path: outcomeReceipt.artifact.path });
        } catch (error) {
          if (error && error.code === P4_CODES.GIT_NOT_FOUND) {
            fail(P4_CODES.STALE_HEAD, `Head moved and outcome ${outcomeReceipt.artifact.path} is absent at new head ${currentHead}`, {
              handoffId,
              oldHead: outcomeReceipt.artifact.head,
              currentHead,
            });
          }
          throw error;
        }
        if (observed.bytes !== expectedOutcomeBytes || gitBlobSha1(observed.bytes) !== outcomeReceipt.artifact.blob) {
          fail(P4_CODES.STALE_HEAD, `Head moved and outcome bytes at new head ${currentHead} no longer match the verified outcome`, {
            handoffId,
            oldHead: outcomeReceipt.artifact.head,
            currentHead,
          });
        }
        // Outcome intact at the new head: fresh readback receipt at the
        // new head, so the close binds current truth, not stale truth.
        const movedReceipt = await readback.verifyBytes({
          repo: outcomeReceipt.artifact.repo,
          commit: currentHead,
          path: outcomeReceipt.artifact.path,
          expectedBytes: expectedOutcomeBytes,
          expectedBlob: outcomeReceipt.artifact.blob,
          verifier: workerId,
          checkedAt: recordedAt,
          reason: "HEAD_MOVED_REVERIFIED",
        });
        movedReceipt.artifact = { ...outcomeReceipt.artifact, commit: currentHead, head: currentHead };
        movedReceipt.handoffId = handoffId;
        movedReceipt.headMovedFrom = outcomeReceipt.artifact.head;
        ledger.readbackReceipts[handoffId] = [...readbacks, movedReceipt];
        ledger.revision += 1;
      } else {
        let observed;
        try {
          observed = await git.read({ repo: outcomeReceipt.artifact.repo, commit: outcomeReceipt.artifact.commit, path: outcomeReceipt.artifact.path });
        } catch (error) {
          if (error && error.code === P4_CODES.GIT_NOT_FOUND) {
            fail(P4_CODES.READBACK_MISMATCH, `Outcome absent at its pinned commit ${outcomeReceipt.artifact.commit} at complete time`, {
              handoffId,
            });
          }
          throw error;
        }
        if (observed.bytes !== expectedOutcomeBytes || gitBlobSha1(observed.bytes) !== outcomeReceipt.artifact.blob) {
          fail(P4_CODES.READBACK_MISMATCH, `Outcome bytes at pinned commit no longer match the verified outcome at complete time`, {
            handoffId,
          });
        }
      }
      // Queue receipt recheck: the queue export must still read back at
      // its pinned commit with the receipt's blob.
      const queueEntry = findOutboxEntry(queueReceipt.queueOperationId);
      if (!queueEntry) {
        fail(P4_CODES.QUEUE_RECEIPT_MISSING, `Outbox intent for queue export ${queueReceipt.queueOperationId} is missing at complete time`, {
          handoffId,
          queueOperationId: queueReceipt.queueOperationId,
        });
      }
      let queueObserved;
      try {
        queueObserved = await git.read({ repo: queueReceipt.queue.repo, commit: queueReceipt.queue.commit, path: queueReceipt.queue.path });
      } catch (error) {
        if (error && error.code === P4_CODES.GIT_NOT_FOUND) {
          fail(P4_CODES.QUEUE_RECEIPT_MISMATCH, `Queue export absent at its pinned commit ${queueReceipt.queue.commit} at complete time`, {
            handoffId,
          });
        }
        throw error;
      }
      if (queueObserved.bytes !== queueEntry.payload.exportBytes || gitBlobSha1(queueObserved.bytes) !== queueReceipt.queue.blob) {
        fail(P4_CODES.QUEUE_RECEIPT_MISMATCH, `Queue export bytes at pinned commit no longer match the queue receipt at complete time`, {
          handoffId,
        });
      }
      // Row-version chain: no newer queue receipt for this item, and
      // the bound task (if any) unmoved and non-terminal.
      const key = queueItemKeyFor(binding);
      const newestForKey = latestQueueReceiptForKey(ledger, key);
      if (!newestForKey || newestForKey.receiptId !== queueReceipt.receiptId) {
        fail(P4_CODES.TASK_MOVED, `A newer queue receipt exists for ${key}; the bound receipt is stale`, {
          handoffId,
          key,
        });
      }
      let nextTasks = tasks;
      if (binding.taskId) {
        const task = boundTaskRecord(binding, tasks);
        checkTaskStillBound(binding, task);
        if (task.snapshotRevision !== queueReceipt.taskSnapshotRevision) {
          fail(P4_CODES.TASK_MOVED, `Bound task ${task.id} snapshot moved between queue answer and complete`, {
            taskId: task.id,
          });
        }
      }
      // TBP4-001 / TBP4-001A: re-check fencing immediately before the
      // commit, not just at entry — this call alone is not enough, since
      // `completeHandoff` itself crosses several more awaits (its own
      // handoff/event-chain reads) before it reaches the actual COMPLETE
      // write. A higher-generation worker can rebind the same `binding`
      // object (checkFencing mutates it in place) during any of those
      // awaits, not just the ones before this line. This preflight check
      // fails fast for the common case without paying for a DB round
      // trip; `fenceCheck` below is the check that actually closes the
      // window, re-validated synchronously immediately adjacent to the
      // COMPLETE write itself, with no await in between.
      checkFencing(binding);
      // All checks pass: append COMPLETE first (the machine validates
      // the full event chain), then close the ledger item. A crash
      // between the two is re-applied by reconcile from the COMPLETE
      // event; a failure here leaves the ledger untouched.
      handoff = await handoffs.completeHandoff(handoffId, {
        actor,
        recordedAt,
        reason,
        fenceCheck: () => checkFencing(binding),
      });
      const queueItem = ledger.queueItems[key];
      if (queueItem) {
        queueItem.status = "CLOSED";
        queueItem.closedAt = recordedAt;
        queueItem.closeActor = actor;
        queueItem.closeReceiptId = queueReceipt.receiptId;
      }
      ledger.revision += 1;
      if (binding.taskId && tasks) {
        nextTasks = tasks.map((t) =>
          t.id === binding.taskId
            ? {
                ...t,
                status: "DONE",
                state: "CLOSED",
                ownerAgent: null,
                lease: null,
                nextAction: null,
                handoffClose: { handoffId, closedAt: recordedAt, receiptId: queueReceipt.receiptId },
                transitions: [
                  ...(t.transitions || []),
                  { at: recordedAt, from: t.status, to: "DONE", reason: "HANDOFF_COMPLETE", handoffId },
                ],
              }
            : t,
        );
      }
      return { handoff, queueItem: queueItem || null, tasks: nextTasks, replayed: false };
    },

    // Restart reconciliation. Read-only assessment by default; the
    // mutating branches (OUTCOME_REAPPLIED, READBACK_ADVANCED,
    // CLOSE_REAPPLIED) enforce worker fencing. Divergent content halts
    // as HALT_CONFLICTING_REPLAY without overwriting anything; unknown
    // states report NEEDS_EVIDENCE or BLOCKED, never a guess.
    async reconcile({ handoffId, tasks = null, verify = null }) {
      const binding = ledger.bindings[handoffId];
      if (!binding) {
        fail(CODES.UNKNOWN_HANDOFF, `Cannot reconcile unknown handoff ${handoffId}`, { id: handoffId });
      }
      const handoff = await handoffs.getHandoff(handoffId);
      const key = queueItemKeyFor(binding);

      if (handoff.state === "OPEN") {
        const delivered = findDeliveredOutcomeEntry(handoffId);
        if (delivered) {
          // A delivery landed but writeOutcome never ran (crash in
          // between): re-derive the outcome from Git truth, then
          // re-apply the transition. Bytes must match the intent.
          try {
            checkFencing(binding);
            const resumed = await finishDeliveredOutcome({
              binding,
              operationId: delivered.payload.operationId,
              actor: `reconcile:${workerId}`,
              recordedAt: delivered.deliveryReceipt.deliveredAt,
              reason: "RECONCILED_DELIVERY",
            });
            return { handoff: resumed.handoff, state: resumed.handoff.state, action: "OUTCOME_REAPPLIED", operationId: delivered.payload.operationId };
          } catch (error) {
            if (error && error.code === CODES.CONFLICTING_REPLAY) {
              return { handoff, state: handoff.state, action: "HALT_CONFLICTING_REPLAY", detail: error.message };
            }
            throw error;
          }
        }
        // No DELIVERED entry: a crashed attempt may still have landed
        // its write with a lost reply. Check Git truth per candidate
        // intent: identical bytes mean landed (reconcile it); bytes
        // whose blob equals the expected prior mean not yet written
        // (republish allowed); anything else occupying the path halts.
        const candidates = outboxEntries.entries.filter(
          (e) => e.payload && e.payload.handoffId === handoffId && e.state !== "DELIVERED",
        );
        for (const candidate of candidates) {
          const intentBytes = stableStringify(candidate.payload);
          let observed = null;
          let readCode = null;
          let currentHead = null;
          try {
            currentHead = await git.head(candidate.targetRepo);
            observed = await git.read({ repo: candidate.targetRepo, commit: currentHead, path: candidate.targetPath });
          } catch (error) {
            readCode = error && error.code ? error.code : null;
          }
          if (readCode === P4_CODES.GIT_UNAVAILABLE) {
            return { handoff, state: handoff.state, action: "BLOCKED", reason: P4_CODES.GIT_UNAVAILABLE };
          }
          if (observed && observed.bytes === intentBytes) {
            try {
              checkFencing(binding);
              const reconciled = markReconciledDelivery(candidate, {
                newBlob: gitBlobSha1(intentBytes),
                head: currentHead,
              });
              const resumed = await finishDeliveredOutcome({
                binding,
                operationId: candidate.operationId,
                actor: `reconcile:${workerId}`,
                recordedAt: reconciled.receipt.deliveredAt,
                reason: "RECONCILED_DELIVERY",
              });
              return { handoff: resumed.handoff, state: resumed.handoff.state, action: "OUTCOME_REAPPLIED", operationId: candidate.operationId };
            } catch (error) {
              if (error && error.code === CODES.CONFLICTING_REPLAY) {
                return { handoff, state: handoff.state, action: "HALT_CONFLICTING_REPLAY", detail: error.message };
              }
              throw error;
            }
          }
          if (observed && gitBlobSha1(observed.bytes) !== candidate.expectedPriorBlob) {
            return {
              handoff,
              state: handoff.state,
              action: "HALT_CONFLICTING_REPLAY",
              detail: `Path ${candidate.targetRepo}/${candidate.targetPath} holds unexpected content (blob ${gitBlobSha1(observed.bytes)}), neither the intended bytes nor the expected prior ${candidate.expectedPriorBlob}`,
            };
          }
          // Absent, or holding exactly the expected prior: republish.
          return { handoff, state: handoff.state, action: "REPUBLISH_ALLOWED", operationId: candidate.operationId };
        }
        return { handoff, state: handoff.state, action: "READY_TO_PUBLISH" };
      }

      if (handoff.state === "OUTCOME_WRITTEN") {
        let outcomeReceipt = ledger.outcomeReceipts[handoffId];
        if (!outcomeReceipt) {
          // Crash between writeOutcome and receipt store: re-derive
          // from a DELIVERED outbox entry plus Git truth.
          const delivered = findDeliveredOutcomeEntry(handoffId);
          if (delivered) {
            try {
              checkFencing(binding);
              const resumed = await finishDeliveredOutcome({
                binding,
                operationId: delivered.payload.operationId,
                actor: `reconcile:${workerId}`,
                recordedAt: delivered.deliveryReceipt.deliveredAt,
                reason: "RECONCILED_DELIVERY",
              });
              outcomeReceipt = resumed.receipt;
            } catch (error) {
              if (error && error.code === CODES.CONFLICTING_REPLAY) {
                return { handoff, state: handoff.state, action: "HALT_CONFLICTING_REPLAY", detail: error.message };
              }
              throw error;
            }
          } else {
            return { handoff, state: handoff.state, action: "NEEDS_EVIDENCE", detail: "outcome receipt missing and no delivered outbox entry to re-derive it from" };
          }
        }
        const readbacks = ledger.readbackReceipts[handoffId] || [];
        if (readbacks.length > 0) {
          // Receipt stored but state never advanced: re-read and, on a
          // match, apply the transition with the receipt's identity.
          // A receipt binding a different artifact is foreign evidence,
          // never a basis to advance this handoff.
          const latest = readbacks[readbacks.length - 1];
          if (latest.artifact && !artifactEquals(latest.artifact, handoff.artifact)) {
            return { handoff, state: handoff.state, action: "READBACK_BLOCKED", detail: "stored readback receipt binds a different artifact" };
          }
          let observed;
          try {
            observed = await git.read({ repo: handoff.artifact.repo, commit: handoff.artifact.commit, path: handoff.artifact.path });
          } catch (error) {
            if (error && (error.code === P4_CODES.GIT_NOT_FOUND || error.code === P4_CODES.GIT_UNAVAILABLE)) {
              return { handoff, state: handoff.state, action: "BLOCKED", reason: error.code };
            }
            throw error;
          }
          if (observed.bytes === stableStringify(findOutboxEntry(outcomeReceipt.operationId)?.payload) && gitBlobSha1(observed.bytes) === handoff.artifact.blob) {
            checkFencing(binding);
            const next = await handoffs.verifyReadback(handoffId, {
              verifier: latest.verifier,
              verifiedAt: latest.checkedAt,
              reason: latest.reason,
              artifact: handoff.artifact,
            });
            return { handoff: next, state: next.state, action: "READBACK_REAPPLIED" };
          }
          return { handoff, state: handoff.state, action: "READBACK_BLOCKED", detail: "outcome bytes no longer match the stored readback receipt" };
        }
        if (!verify) {
          return { handoff, state: handoff.state, action: "READBACK_REQUIRED" };
        }
        try {
          checkFencing(binding);
          const advanced = await this.verifyReadback({
            handoffId,
            verifier: verify.verifier,
            checkedAt: verify.checkedAt,
            reason: verify.reason,
          });
          return { handoff: advanced.handoff, state: advanced.handoff.state, action: "READBACK_ADVANCED" };
        } catch (error) {
          if (error && error.code === P4_CODES.STALE_WORKER) throw error;
          return { handoff, state: handoff.state, action: "READBACK_BLOCKED", reason: error.code, detail: error.message };
        }
      }

      if (handoff.state === "READBACK_VERIFIED") {
        const outcomeReceipt = ledger.outcomeReceipts[handoffId];
        if (!outcomeReceipt) {
          return { handoff, state: handoff.state, action: "NEEDS_EVIDENCE", detail: "outcome receipt missing at READBACK_VERIFIED" };
        }
        try {
          const observed = await git.read({ repo: handoff.artifact.repo, commit: handoff.artifact.commit, path: handoff.artifact.path });
          const expected = stableStringify(findOutboxEntry(outcomeReceipt.operationId)?.payload);
          if (observed.bytes === expected && gitBlobSha1(observed.bytes) === handoff.artifact.blob) {
            return { handoff, state: handoff.state, action: "READY_FOR_QUEUE" };
          }
          return { handoff, state: handoff.state, action: "READBACK_BLOCKED", detail: "outcome bytes no longer match at pinned commit" };
        } catch (error) {
          if (error && (error.code === P4_CODES.GIT_NOT_FOUND || error.code === P4_CODES.GIT_UNAVAILABLE)) {
            return { handoff, state: handoff.state, action: "BLOCKED", reason: error.code };
          }
          throw error;
        }
      }

      if (handoff.state === "QUEUE_UPDATED") {
        const queueReceipt = latestQueueReceiptForHandoff(ledger, handoffId);
        if (!queueReceipt || queueReceipt.status !== "ANSWER_RECORDED_PENDING_CLOSE") {
          return { handoff, state: handoff.state, action: "NEEDS_EVIDENCE", detail: "no pending-close queue receipt; re-run recordQueueAnswer to resume" };
        }
        if (binding.taskId && tasks) {
          try {
            const task = boundTaskRecord(binding, tasks);
            checkTaskStillBound(binding, task);
          } catch (error) {
            return { handoff, state: handoff.state, action: "BLOCKED", reason: error.code, detail: error.message };
          }
        }
        try {
          const queueEntry = findOutboxEntry(queueReceipt.queueOperationId);
          const observed = await git.read({ repo: queueReceipt.queue.repo, commit: queueReceipt.queue.commit, path: queueReceipt.queue.path });
          if (queueEntry && observed.bytes === queueEntry.payload.exportBytes && gitBlobSha1(observed.bytes) === queueReceipt.queue.blob) {
            return { handoff, state: handoff.state, action: "READY_TO_COMPLETE" };
          }
          return { handoff, state: handoff.state, action: "BLOCKED", reason: P4_CODES.QUEUE_RECEIPT_MISMATCH };
        } catch (error) {
          if (error && (error.code === P4_CODES.GIT_NOT_FOUND || error.code === P4_CODES.GIT_UNAVAILABLE)) {
            return { handoff, state: handoff.state, action: "BLOCKED", reason: error.code };
          }
          throw error;
        }
      }

      if (handoff.state === "COMPLETE") {
        const queueItem = ledger.queueItems[key];
        if (queueItem && queueItem.status === "CLOSED") {
          return { handoff, state: handoff.state, action: "NONE" };
        }
        if (queueItem && queueItem.status === "ANSWER_RECORDED_PENDING_CLOSE") {
          // Crash between COMPLETE and the ledger close: re-apply the
          // close idempotently from the COMPLETE event. The machine
          // state already proves completion; this only closes the item.
          checkFencing(binding);
          // TBP4-002: a historical COMPLETE event is not, by itself,
          // authority to close a task that has since been reassigned.
          // Re-verify the same snapshot/epoch binding completeVerified
          // itself requires, before reapplying the close — never infer
          // the bound task is still unmoved from the COMPLETE event
          // alone.
          if (binding.taskId) {
            try {
              const task = boundTaskRecord(binding, tasks);
              checkTaskStillBound(binding, task);
            } catch (error) {
              if (error && (error.code === P4_CODES.TASK_MOVED || error.code === P4_CODES.UNKNOWN_TASK_BINDING)) {
                return { handoff, state: handoff.state, action: "TASK_REASSIGNED", reason: error.code, detail: error.message };
              }
              throw error;
            }
          }
          queueItem.status = "CLOSED";
          queueItem.closedAt = queueItem.closedAt || handoff.updatedAt;
          queueItem.closeActor = queueItem.closeActor || "reconciled";
          ledger.revision += 1;
          let nextTasks = tasks;
          if (binding.taskId && tasks) {
            nextTasks = tasks.map((t) =>
              t.id === binding.taskId && !TERMINAL_TASK_STATUSES.has(t.status)
                ? {
                    ...t,
                    status: "DONE",
                    state: "CLOSED",
                    ownerAgent: null,
                    lease: null,
                    nextAction: null,
                    handoffClose: { handoffId, closedAt: queueItem.closedAt, receiptId: queueItem.lastQueueReceiptId },
                    transitions: [
                      ...(t.transitions || []),
                      { at: queueItem.closedAt, from: t.status, to: "DONE", reason: "HANDOFF_COMPLETE_RECONCILED", handoffId },
                    ],
                  }
                : t,
            );
          }
          return { handoff, state: handoff.state, action: "CLOSE_REAPPLIED", tasks: nextTasks };
        }
        return { handoff, state: handoff.state, action: "NEEDS_EVIDENCE", detail: "handoff COMPLETE but no queue item to close" };
      }

      return { handoff, state: handoff.state, action: "UNKNOWN_STATE" };
    },
  };
}
