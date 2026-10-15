// Team Brain slice 1 — fixture report builder.
//
// Drives the ledger repository and handoff machine from a validated synthetic
// fixture, runs the pure queue projection with the injected `now`, and
// returns a deterministic plain-JSON report. No wall-clock reads: every
// timestamp comes from the fixture or the CLI's --now flag.

import { projectQueue } from "../queue/projection.mjs";

function sourceOf(entry) {
  return {
    repo: entry.source.repo,
    path: entry.source.path,
    commit: entry.source.commit,
    blob: entry.source.blob,
    head: entry.source.head,
  };
}

export async function buildFixtureReport({ repo, handoffs, fixture, now, fixtureName }) {
  // 1. File obligations.
  for (const entry of fixture.obligations) {
    await repo.fileObligation({
      id: entry.id,
      kind: entry.kind,
      filedAt: entry.filedAt,
      source: sourceOf(entry),
      retentionDisposition: entry.retentionDisposition,
      dependencies: entry.dependencies || [],
      priorityOverride: entry.priorityOverride || null,
      filedBy: entry.filedBy || "fixture",
      filedReason: entry.filedReason || "synthetic fixture",
    });
  }

  // 2. Drive lifecycle ops in fixture order.
  for (const op of fixture.lifecycle) {
    const at = op.recordedAt || now;
    switch (op.op) {
      case "note":
        await repo.appendAnnotation(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          eventType: "NOTE",
          reason: op.reason || "fixture note",
          evidenceRefs: op.evidenceRefs || [],
        });
        break;
      case "reping":
        await repo.appendAnnotation(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          eventType: "REPING_SENT",
          reason: op.reason || "synthetic re-ping recorded",
          evidenceRefs: [],
        });
        break;
      case "reportToJason":
        await repo.appendAnnotation(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          eventType: "REPORT_TO_JASON_SENT",
          reason: op.reason || "synthetic report-to-Jason recorded",
          evidenceRefs: [],
        });
        break;
      case "recordVerification":
        await repo.recordVerification(op.id, {
          verifier: op.verifier || "fixture",
          verifiedAt: op.verifiedAt || now,
          reason: op.reason || "synthetic verification",
          evidenceRefs: op.evidenceRefs || [],
        });
        break;
      case "closeTask":
        await repo.closeTask(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          reason: op.reason || "synthetic close",
          evidenceRefs: op.evidenceRefs || [],
        });
        break;
      case "revokeAuthorization":
        await repo.revokeAuthorization(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          reason: op.reason || "synthetic revocation",
        });
        break;
      case "supersedeVerdict":
        await repo.supersedeVerdict(
          op.oldId,
          {
            id: op.new.id,
            kind: "VERDICT",
            filedAt: op.new.filedAt,
            source: sourceOf(op.new),
            retentionDisposition: op.new.retentionDisposition,
            filedBy: op.actor || "fixture",
            filedReason: op.reason || "synthetic supersession",
          },
          { actor: op.actor || "fixture", recordedAt: at, reason: op.reason || "synthetic supersession" },
        );
        break;
      case "correctEvidence":
        await repo.correctEvidence(
          op.oldId,
          {
            id: op.new.id,
            kind: "EVIDENCE",
            filedAt: op.new.filedAt,
            source: sourceOf(op.new),
            retentionDisposition: op.new.retentionDisposition,
            filedBy: op.actor || "fixture",
            filedReason: op.reason || "synthetic correction",
          },
          { actor: op.actor || "fixture", recordedAt: at, reason: op.reason || "synthetic correction" },
        );
        break;
      case "setRetention":
        await repo.setRetentionDisposition(op.id, {
          actor: op.actor || "fixture",
          recordedAt: at,
          reason: op.reason || "synthetic retention decision",
          disposition: op.disposition,
        });
        break;
      default:
        throw new Error(`buildFixtureReport: unhandled lifecycle op ${op.op}`);
    }
  }

  // 3. Drive handoffs.
  const handoffStates = [];
  for (const h of fixture.handoffs) {
    await handoffs.beginHandoff(h.id, {
      actor: (h.begin && h.begin.actor) || "fixture",
      recordedAt: (h.begin && h.begin.recordedAt) || now,
      reason: (h.begin && h.begin.reason) || "synthetic handoff",
    });
    for (const step of h.steps) {
      const at = step.recordedAt || now;
      switch (step.op) {
        case "writeOutcome":
          await handoffs.writeOutcome(h.id, {
            actor: step.actor || "fixture",
            recordedAt: at,
            reason: step.reason || "synthetic outcome",
            artifact: step.artifact,
          });
          break;
        case "verifyReadback":
          await handoffs.verifyReadback(h.id, {
            verifier: step.verifier || "fixture",
            verifiedAt: step.verifiedAt || at,
            reason: step.reason || "synthetic readback",
            artifact: step.artifact,
          });
          break;
        case "updateQueue":
          await handoffs.updateQueue(h.id, {
            actor: step.actor || "fixture",
            recordedAt: at,
            reason: step.reason || "synthetic queue update",
            queue: step.queue,
          });
          break;
        case "complete":
          await handoffs.completeHandoff(h.id, {
            actor: step.actor || "fixture",
            recordedAt: at,
            reason: step.reason || "synthetic completion",
          });
          break;
        default:
          throw new Error(`buildFixtureReport: unhandled handoff step ${step.op}`);
      }
    }
    const current = await handoffs.getHandoff(h.id);
    handoffStates.push({ id: current.id, state: current.state });
  }

  // 4. Pure projection over the ledger snapshot with the injected now.
  // Trusted Jason authorization records are injected by the host (here, the
  // synthetic fixture); overrides resolve their authorityRef against them.
  const queue = projectQueue({
    obligations: await repo.queueSnapshot(),
    now,
    trustedAuthorizations: fixture.trustedAuthorizations || [],
  });

  // 5. Deterministic report. Counts only — no PGlite internals, no wall clock.
  const obligationRows = await repo.listObligations();
  let eventCount = 0;
  for (const o of obligationRows) {
    eventCount += (await repo.getEvents(o.id)).length;
  }

  return {
    report: "team-brain-slice-1/fixture",
    now,
    fixture: fixtureName,
    description: fixture.description,
    queue: {
      ordered: queue.ordered,
      blocked: queue.blocked,
      oldest: queue.oldest,
      oldestAgeMs: queue.oldestAgeMs,
      escalations: queue.escalations,
      overrides: queue.overrides,
    },
    handoffs: handoffStates,
    ledger: { obligations: obligationRows.length, events: eventCount },
  };
}
