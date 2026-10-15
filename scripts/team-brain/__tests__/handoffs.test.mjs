// Team Brain slice 1 — handoff state machine acceptance tests (criteria 16-21).

import { afterAll, describe, expect, it } from "vitest";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);
import { CODES } from "../ledger/errors.mjs";
import { freshBackend, artifact, queueRef, tempDir, T0, cleanupTempDirs } from "./helpers.mjs";

const T1 = "2026-10-14T17:00:00Z";
const T2 = "2026-10-14T17:05:00Z";
const T3 = "2026-10-14T17:10:00Z";
const T4 = "2026-10-14T17:15:00Z";

async function begun(handoffs, id = "h-1") {
  return handoffs.beginHandoff(id, { actor: "Muse", recordedAt: T0, reason: "test handoff" });
}

describe("handoff gating", () => {
  afterAll(cleanupTempDirs);
  it30("AC-16: skipped or out-of-order transitions are rejected without partial state", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      // Skip straight to completion from OPEN.
      await expect(
        handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "skip" }),
      ).rejects.toMatchObject({ code: CODES.SKIPPED_TRANSITION });
      // Verify-before-write is out of order.
      await expect(
        handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() }),
      ).rejects.toMatchObject({ code: CODES.SKIPPED_TRANSITION });
      // No partial state: still OPEN, only the begin event recorded.
      expect((await handoffs.getHandoff("h-1")).state).toBe("OPEN");
      expect(await handoffs.getEvents("h-1")).toHaveLength(1);
      // Queue update before readback is out of order.
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await expect(
        handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() }),
      ).rejects.toMatchObject({ code: CODES.SKIPPED_TRANSITION });
      expect((await handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
    } finally {
      await db.close();
    }
  });

  it30("AC-17: readback must bind the exact written artifact; a changed SHA/blob is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await expect(
        handoffs.verifyReadback("h-1", {
          verifier: "Muse",
          verifiedAt: T2,
          reason: "v",
          artifact: artifact({ commit: "changed999", blob: "blob999", head: "changed999" }),
        }),
      ).rejects.toMatchObject({ code: CODES.STALE_BINDING });
      expect((await handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
      const ok = await handoffs.verifyReadback("h-1", {
        verifier: "Muse",
        verifiedAt: T2,
        reason: "v",
        artifact: artifact(),
      });
      expect(ok.state).toBe("READBACK_VERIFIED");
    } finally {
      await db.close();
    }
  });

  it30("AC-18: queue update must be durable before completion; missing or stale queue evidence blocks completion", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      // Completion without the queue step is a skip.
      await expect(
        handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" }),
      ).rejects.toMatchObject({ code: CODES.SKIPPED_TRANSITION });
      // Queue evidence with a missing blob is rejected; nothing partial.
      await expect(
        handoffs.updateQueue("h-1", {
          actor: "Muse",
          recordedAt: T3,
          reason: "q",
          queue: queueRef({ blob: "" }),
        }),
      ).rejects.toMatchObject({ code: CODES.MISSING_QUEUE_EVIDENCE });
      expect((await handoffs.getHandoff("h-1")).state).toBe("READBACK_VERIFIED");
      // Proper queue update then completion succeeds.
      await handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
      const done = await handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" });
      expect(done.state).toBe("COMPLETE");
    } finally {
      await db.close();
    }
  });

  it30("AC-19: exact transition replay is idempotent; conflicting replay is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      const eventsBefore = await handoffs.getEvents("h-1");
      // Exact replay: same state, no second event.
      const replayed = await handoffs.writeOutcome("h-1", {
        actor: "Muse",
        recordedAt: T1,
        reason: "w",
        artifact: artifact(),
      });
      expect(replayed.state).toBe("OUTCOME_WRITTEN");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
      // Conflicting replay: different artifact binding.
      await expect(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "w",
          artifact: artifact({ blob: "blob-other" }),
        }),
      ).rejects.toMatchObject({ code: CODES.CONFLICTING_REPLAY });
    } finally {
      await db.close();
    }
  });

  it30("AC-20: forced restart after each intermediate state recovers that state and never advances it", async () => {
    const dir = tempDir("tb-ac20-");
    const states = ["OUTCOME_WRITTEN", "READBACK_VERIFIED", "QUEUE_UPDATED", "COMPLETE"];

    // Drive to each state in sequence, restarting the backend before checking.
    async function runTo(targetIndex) {
      const b = await freshBackend(dir);
      await b.handoffs.beginHandoff("h-1", { actor: "Muse", recordedAt: T0, reason: "test" });
      const done = await b.handoffs.getHandoff("h-1");
      const apply = [
        () => b.handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() }),
        () =>
          b.handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() }),
        () => b.handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() }),
        () => b.handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" }),
      ];
      // Only advance if the recovered state is behind the target.
      const order = ["OPEN", ...states];
      const currentIndex = order.indexOf(done.state);
      for (let i = currentIndex; i <= targetIndex; i++) {
        await apply[i]();
      }
      await b.db.close();
    }

    for (let target = 0; target < states.length; target++) {
      await runTo(target);
      const check = await freshBackend(dir);
      try {
        const h = await check.handoffs.getHandoff("h-1");
        expect(h.state, `after restart, state must be exactly ${states[target]}`).toBe(states[target]);
      } finally {
        await check.db.close();
      }
    }
  });

  it30("AC-21: a fixture containing chat-only done text cannot advance a handoff", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      // Chat-style payload with no artifact binding.
      await expect(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "done, trust me",
          artifact: null,
        }),
      ).rejects.toMatchObject({ code: CODES.MISSING_ARTIFACT_BINDING });
      // Binding with empty pointers is equally rejected.
      await expect(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "done",
          artifact: { repo: "x", path: "y", commit: "", blob: "", head: "" },
        }),
      ).rejects.toMatchObject({ code: CODES.MISSING_ARTIFACT_BINDING });
      expect((await handoffs.getHandoff("h-1")).state).toBe("OPEN");
    } finally {
      await db.close();
    }
  });

  it30("full chain completes in order and the event log shows the four transitions", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await begun(handoffs);
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
      const done = await handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" });
      expect(done.state).toBe("COMPLETE");
      expect(done.artifact).toEqual(artifact());
      expect(done.queue).toEqual(queueRef());
      const events = await handoffs.getEvents("h-1");
      expect(events.map((e) => `${e.from_state}->${e.to_state}`)).toEqual([
        "OPEN->OPEN",
        "OPEN->OUTCOME_WRITTEN",
        "OUTCOME_WRITTEN->READBACK_VERIFIED",
        "READBACK_VERIFIED->QUEUE_UPDATED",
        "QUEUE_UPDATED->COMPLETE",
      ]);
    } finally {
      await db.close();
    }
  });
});
