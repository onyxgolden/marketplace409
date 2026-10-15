// Team Brain slice 1 — fix-round-2 regression tests (TB-002/TB-004 residuals).
// Each test reproduces a ChatGPT probe from the PR #625 corrected-head
// re-review verdict (results/chatgpt/team-brain-slice1-rereview-2026-10-15.md)
// and proves the fix. TB-001/TB-003/TB-005/TB-006 stay closed; the 53 prior
// tests must keep passing.

import { afterAll, describe, expect, it } from "vitest";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);
import { PGlite } from "@electric-sql/pglite";
import { CODES } from "../ledger/errors.mjs";
import { createRepository } from "../ledger/repository.mjs";
import { createHandoffMachine } from "../handoffs/stateMachine.mjs";
import { projectQueue } from "../queue/projection.mjs";
import { freshBackend, artifact, queueRef, tempDir, T0, cleanupTempDirs, taskRecord } from "./helpers.mjs";

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ name: "TeamBrainError", code });
}

const T1 = "2026-10-14T17:00:00Z";
const T2 = "2026-10-14T17:05:00Z";
const T3 = "2026-10-14T17:10:00Z";
const T4 = "2026-10-14T17:15:00Z";
const T5 = "2026-10-14T17:20:00Z";

async function backendWithTrusted(trustedAuthorizations) {
  const db = new PGlite();
  const repo = createRepository(db, { trustedAuthorizations });
  await repo.migrate();
  const handoffs = createHandoffMachine(db);
  return { db, repo, handoffs };
}

function goodOverride(authorityRef = "authz-1") {
  return { rank: 0, actor: "Muse", recordedAt: T1, reason: "Jason pinned this", authorityRef };
}

function trustedRecord(overrides = {}) {
  return { id: "authz-1", granter: "Jason", itemId: "t-1", revoked: false, rank: 0, ...overrides };
}

describe("TB-004 residual: replay identity binds repo/path and recorded attribution", () => {
  afterAll(cleanupTempDirs);

  async function written(handoffs, id = "h-1") {
    await handoffs.beginHandoff(id, { actor: "Muse", recordedAt: T0, reason: "test" });
    await handoffs.writeOutcome(id, { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
  }

  it30("verdict probe: writeOutcome replay with same hashes but different repo is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      const eventsBefore = await handoffs.getEvents("h-1");
      await expectCode(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "w",
          artifact: artifact({ repo: "different/repo", path: "wrong.md" }),
        }),
        CODES.CONFLICTING_REPLAY,
      );
      expect((await handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
    } finally {
      await db.close();
    }
  });

  it30("verdict probe: writeOutcome replay with same hashes but different path is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await expectCode(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "w",
          artifact: artifact({ path: "wrong.md" }),
        }),
        CODES.CONFLICTING_REPLAY,
      );
      expect((await handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
    } finally {
      await db.close();
    }
  });

  it30("verdict probe: updateQueue replay with same hashes but different repo/path is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
      const eventsBefore = await handoffs.getEvents("h-1");
      await expectCode(
        handoffs.updateQueue("h-1", {
          actor: "Muse",
          recordedAt: T3,
          reason: "q",
          queue: queueRef({ repo: "different/drop", path: "unrelated.md" }),
        }),
        CODES.CONFLICTING_REPLAY,
      );
      expect((await handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
    } finally {
      await db.close();
    }
  });

  it30("verdict probe: verifyReadback replay with a new verifiedAt is not an exact replay", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await expectCode(
        handoffs.verifyReadback("h-1", {
          verifier: "Muse",
          verifiedAt: T5, // same verifier and artifact, new time
          reason: "v",
          artifact: artifact(),
        }),
        CODES.CONFLICTING_REPLAY,
      );
      expect((await handoffs.getHandoff("h-1")).state).toBe("READBACK_VERIFIED");
    } finally {
      await db.close();
    }
  });

  it30("verifyReadback replay with a new reason is not an exact replay", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await expectCode(
        handoffs.verifyReadback("h-1", {
          verifier: "Muse",
          verifiedAt: T2,
          reason: "a different reason",
          artifact: artifact(),
        }),
        CODES.CONFLICTING_REPLAY,
      );
    } finally {
      await db.close();
    }
  });

  it30("writeOutcome replay with a different actor is not an exact replay", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await expectCode(
        handoffs.writeOutcome("h-1", {
          actor: "someone-else",
          recordedAt: T1,
          reason: "w",
          artifact: artifact(),
        }),
        CODES.CONFLICTING_REPLAY,
      );
    } finally {
      await db.close();
    }
  });

  it30("identical full replay after COMPLETE returns current state with no second event", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await written(handoffs);
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
      await handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" });
      const eventsBefore = await handoffs.getEvents("h-1");
      // Exact retry of an earlier step after completion: recognized from history.
      const replayed = await handoffs.writeOutcome("h-1", {
        actor: "Muse",
        recordedAt: T1,
        reason: "w",
        artifact: artifact(),
      });
      expect(replayed.state).toBe("COMPLETE");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
      // Identical completion replay is equally idempotent.
      const completed = await handoffs.completeHandoff("h-1", { actor: "Muse", recordedAt: T4, reason: "c" });
      expect(completed.state).toBe("COMPLETE");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
    } finally {
      await db.close();
    }
  });

  it30("changed repo/path replay is still rejected after a restart", async () => {
    const dir = tempDir("tb-r2-ac20-");
    {
      const b = await freshBackend(dir);
      try {
        await b.handoffs.beginHandoff("h-1", { actor: "Muse", recordedAt: T0, reason: "test" });
        await b.handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      } finally {
        await b.db.close();
      }
    }
    const check = await freshBackend(dir);
    try {
      expect((await check.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
      await expectCode(
        check.handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "w",
          artifact: artifact({ repo: "different/repo", path: "wrong.md" }),
        }),
        CODES.CONFLICTING_REPLAY,
      );
      // Identical replay after restart is still idempotent.
      const replayed = await check.handoffs.writeOutcome("h-1", {
        actor: "Muse",
        recordedAt: T1,
        reason: "w",
        artifact: artifact(),
      });
      expect(replayed.state).toBe("OUTCOME_WRITTEN");
    } finally {
      await check.db.close();
    }
  });
});

describe("TB-002 residual: unknown authority overrides are refused at the write boundary", () => {
  afterAll(cleanupTempDirs);

  it30("verdict probe: unknown authorityRef never persists; queue reads stay healthy", async () => {
    const { db, repo } = await backendWithTrusted([]);
    try {
      await expectCode(
        repo.fileObligation(
          taskRecord("t-1", T0, {
            priorityOverride: { rank: 0, actor: "fixture", recordedAt: T1, reason: "probe", authorityRef: "no-such-grant" },
          }),
        ),
        CODES.UNKNOWN_AUTHORITY,
      );
      // Refusal left no record and no event.
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
      expect(await repo.listObligations()).toHaveLength(0);
      // Unrelated work remains projectable: no poisoned queue read.
      await repo.fileObligation(taskRecord("t-plain"));
      const q = projectQueue({ obligations: await repo.queueSnapshot(), now: T2, trustedAuthorizations: [] });
      expect(q.actionable).toContain("t-plain");
    } finally {
      await db.close();
    }
  });

  it30("non-Jason granter is refused at write time", async () => {
    const trusted = [trustedRecord({ granter: "ChatGPT" })];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      await expectCode(repo.fileObligation(taskRecord("t-1", T0, { priorityOverride: goodOverride() })), CODES.INVALID_OVERRIDE);
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });

  it30("wrong-item binding is refused at write time", async () => {
    const trusted = [trustedRecord({ itemId: "some-other-task" })];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      await expectCode(repo.fileObligation(taskRecord("t-1", T0, { priorityOverride: goodOverride() })), CODES.INVALID_OVERRIDE);
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });

  it30("revoked grant is refused at write time", async () => {
    const trusted = [trustedRecord({ revoked: true })];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      await expectCode(repo.fileObligation(taskRecord("t-1", T0, { priorityOverride: goodOverride() })), CODES.INVALID_OVERRIDE);
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });

  it30("rank mismatch is refused at write time", async () => {
    const trusted = [trustedRecord({ rank: 5 })];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      await expectCode(
        repo.fileObligation(taskRecord("t-1", T0, { priorityOverride: goodOverride() })),
        CODES.INVALID_OVERRIDE,
      );
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });

  it30("a valid Jason grant files and projects; malformed shape still fails first", async () => {
    const trusted = [trustedRecord()];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      const filed = await repo.fileObligation(taskRecord("t-1", T0, { priorityOverride: goodOverride() }));
      expect(filed.state).toBe("OPEN");
      expect(filed.priorityOverride.authorityRef).toBe("authz-1");
      await repo.fileObligation(taskRecord("t-plain"));
      const q = projectQueue({ obligations: await repo.queueSnapshot(), now: T2, trustedAuthorizations: trusted });
      expect(q.ordered[0]).toBe("t-1");
      expect(q.overrides[0].authorityRef).toBe("authz-1");
      // Free-text self-attestation still rejected at the boundary.
      await expectCode(
        repo.fileObligation(
          taskRecord("t-2", T0, {
            priorityOverride: { rank: 0, actor: "attacker", recordedAt: T1, reason: "x", authority: "Jason" },
          }),
        ),
        CODES.INVALID_OVERRIDE,
      );
    } finally {
      await db.close();
    }
  });

  it30("a batch containing a bad override is refused atomically", async () => {
    const trusted = [trustedRecord()];
    const { db, repo } = await backendWithTrusted(trusted);
    try {
      await expect(
        repo.fileObligationBatch([
          taskRecord("t-1", T0, { priorityOverride: goodOverride() }),
          taskRecord("t-2", T0, {
            priorityOverride: { rank: 0, actor: "fixture", recordedAt: T1, reason: "probe", authorityRef: "no-such-grant" },
          }),
        ]),
      ).rejects.toMatchObject({ name: "TeamBrainError", code: CODES.UNKNOWN_AUTHORITY });
      expect(await repo.listObligations()).toHaveLength(0);
    } finally {
      await db.close();
    }
  });
});
