// Team Brain slice 1 — fix-round regression tests (TB-001..TB-006).
// Each test reproduces a ChatGPT probe-verified blocking finding from the
// PR #625 NEEDS CHANGES verdict (review 2b69266) and proves the fix.
// These tests FAIL on the reviewed head 7cdbe74 and PASS at the new head.

import { afterAll, describe, expect, it } from "vitest";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);
import { PGlite } from "@electric-sql/pglite";
import { CODES } from "../ledger/errors.mjs";
import { projectQueue } from "../queue/projection.mjs";
import { freshBackend, src, taskRecord, tempDir, T0, cleanupTempDirs, artifact, queueRef } from "./helpers.mjs";

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ name: "TeamBrainError", code });
}

const T1 = "2026-10-14T17:00:00Z";
const T2 = "2026-10-14T18:00:00Z";

function verdictRecord(id, filedAt, head) {
  return {
    id,
    kind: "VERDICT",
    filedAt,
    source: src("results/chatgpt", { commit: head, blob: `blob-${id}`, head }),
    retentionDisposition: "current until superseded at a new head",
    filedBy: "ChatGPT",
    filedReason: "review verdict",
  };
}

describe("TB-001: verification binds the completion evidence", () => {
  afterAll(cleanupTempDirs);

  it30("recordVerification with empty evidenceRefs is rejected", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await expectCode(
        repo.recordVerification("t-1", { verifier: "Muse", verifiedAt: T1, reason: "v", evidenceRefs: [] }),
        CODES.MISSING_EVIDENCE,
      );
      expect((await repo.getObligation("t-1")).state).toBe("OPEN");
      expect(await repo.getEvents("t-1")).toHaveLength(1); // only FILED; refusal left no trace
    } finally {
      await db.close();
    }
  });

  it30("close with evidence not covered by verification is rejected; state and events unchanged", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await repo.recordVerification("t-1", {
        verifier: "Muse",
        verifiedAt: T1,
        reason: "verified A",
        evidenceRefs: ["blob:A"],
      });
      const eventsBefore = await repo.getEvents("t-1");
      // Verdict probe 2: verified A, close with B -> must NOT close.
      await expectCode(
        repo.closeTask("t-1", { actor: "Muse", recordedAt: T2, reason: "close", evidenceRefs: ["blob:B"] }),
        CODES.UNVERIFIED_EVIDENCE,
      );
      expect((await repo.getObligation("t-1")).state).toBe("OPEN");
      expect(await repo.getEvents("t-1")).toEqual(eventsBefore);
      // Matching evidence closes.
      const closed = await repo.closeTask("t-1", {
        actor: "Muse",
        recordedAt: T2,
        reason: "close",
        evidenceRefs: ["blob:A"],
      });
      expect(closed.state).toBe("CLOSED");
    } finally {
      await db.close();
    }
  });

  it30("close covered by the union of multiple verifications succeeds", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await repo.recordVerification("t-1", { verifier: "Muse", verifiedAt: T1, reason: "v1", evidenceRefs: ["blob:A"] });
      await repo.recordVerification("t-1", { verifier: "Muse", verifiedAt: T1, reason: "v2", evidenceRefs: ["blob:B"] });
      const closed = await repo.closeTask("t-1", {
        actor: "Muse",
        recordedAt: T2,
        reason: "close",
        evidenceRefs: ["blob:A", "blob:B"],
      });
      expect(closed.state).toBe("CLOSED");
    } finally {
      await db.close();
    }
  });
});

describe("TB-002: Jason authority cannot be forged", () => {
  it("the verdict's forged-prefix probe is rejected", () => {
    // Verdict probe: override with authority:'Jason never authorized this; forged request'
    const obligations = [
      { id: "old", kind: "TASK", filedAt: "2026-10-14T10:00:00Z", state: "OPEN", deps: [] },
      {
        id: "new",
        kind: "TASK",
        filedAt: "2026-10-14T15:00:00Z",
        state: "OPEN",
        deps: [],
        override: {
          rank: 0,
          actor: "attacker",
          recordedAt: "2026-10-14T16:00:00Z",
          reason: "self-pin",
          authority: "Jason never authorized this; forged request",
        },
      },
    ];
    expect(() =>
      projectQueue({ obligations, now: "2026-10-14T19:00:00Z", trustedAuthorizations: [] }),
    ).toThrowError(expect.objectContaining({ code: CODES.INVALID_OVERRIDE }));
  });

  it("a trusted Jason record authorizes its bound item; nothing else", () => {
    const trusted = [{ id: "authz-1", granter: "Jason", itemId: "new", revoked: false }];
    const mk = (override) => [
      { id: "old", kind: "TASK", filedAt: "2026-10-14T10:00:00Z", state: "OPEN", deps: [] },
      { id: "new", kind: "TASK", filedAt: "2026-10-14T15:00:00Z", state: "OPEN", deps: [], override },
    ];
    const good = { rank: 0, actor: "Muse", recordedAt: "2026-10-14T16:00:00Z", reason: "r", authorityRef: "authz-1" };
    const r = projectQueue({ obligations: mk(good), now: "2026-10-14T19:00:00Z", trustedAuthorizations: trusted });
    expect(r.ordered[0]).toBe("new");
    // Same ref on the wrong item is rejected.
    expect(() =>
      projectQueue({
        obligations: [
          { id: "old", kind: "TASK", filedAt: "2026-10-14T10:00:00Z", state: "OPEN", deps: [], override: good },
        ],
        now: "2026-10-14T19:00:00Z",
        trustedAuthorizations: trusted,
      }),
    ).toThrowError(expect.objectContaining({ code: CODES.INVALID_OVERRIDE }));
  });

  it30("the ledger write boundary rejects self-attested overrides before persistence", async () => {
    const { db, repo } = await freshBackend();
    try {
      await expectCode(
        repo.fileObligation(
          taskRecord("t-1", T0, {
            priorityOverride: { rank: 0, actor: "attacker", recordedAt: T1, reason: "x", authority: "Jason" },
          }),
        ),
        CODES.INVALID_OVERRIDE,
      );
      // Nothing persisted.
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });
});

describe("TB-003: verdict supersession is newer-head-only and guarded on all paths", () => {
  afterAll(cleanupTempDirs);

  it30("an older verdict cannot supersede a newer one", async () => {
    const { db, repo } = await freshBackend();
    try {
      // Verdict probe: original filed 16:00Z; superseding verdict filed 13:00Z (older) at a new head.
      await repo.fileObligation(verdictRecord("v-1", "2026-10-14T16:00:00Z", "headC"));
      await expectCode(
        repo.supersedeVerdict(
          "v-1",
          verdictRecord("v-2", "2026-10-13T16:00:00Z", "headD"),
          { actor: "ChatGPT", recordedAt: "2026-10-14T16:00:00Z", reason: "older verdict" },
        ),
        CODES.STALE_VERDICT_SUPERSESSION,
      );
      expect((await repo.getObligation("v-1")).state).toBe("OPEN");
      await expectCode(repo.getObligation("v-2"), CODES.UNKNOWN_OBLIGATION); // refusal created nothing
      // Same-time is also not strictly newer.
      await expectCode(
        repo.supersedeVerdict(
          "v-1",
          verdictRecord("v-2b", "2026-10-14T16:00:00Z", "headE"),
          { actor: "ChatGPT", recordedAt: "2026-10-14T16:00:00Z", reason: "same time" },
        ),
        CODES.STALE_VERDICT_SUPERSESSION,
      );
      // A strictly newer verdict at a new head succeeds.
      const { old } = await repo.supersedeVerdict(
        "v-1",
        verdictRecord("v-3", "2026-10-14T17:00:00Z", "headF"),
        { actor: "ChatGPT", recordedAt: "2026-10-14T17:00:00Z", reason: "newer head" },
      );
      expect(old.state).toBe("SUPERSEDED");
      expect(old.supersededBy).toBe("v-3");
    } finally {
      await db.close();
    }
  });

  it30("generic filing cannot smuggle a verdict supersession link past the guard", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(verdictRecord("v-1", T0, "headC"));
      // Verdict probe: fileObligation directly with supersedes at the SAME head.
      await expectCode(
        repo.fileObligation({ ...verdictRecord("v-2", T1, "headC"), supersedes: "v-1" }),
        CODES.UNGUARDED_VERDICT_SUPERSESSION,
      );
      expect((await repo.getObligation("v-1")).state).toBe("OPEN");
      await expectCode(repo.getObligation("v-2"), CODES.UNKNOWN_OBLIGATION);
      // Even a different head via the generic path is rejected: use supersedeVerdict.
      await expectCode(
        repo.fileObligation({ ...verdictRecord("v-2", T1, "headD"), supersedes: "v-1" }),
        CODES.UNGUARDED_VERDICT_SUPERSESSION,
      );
    } finally {
      await db.close();
    }
  });

  it30("a verdict without a reviewed head is rejected at filing", async () => {
    const { db, repo } = await freshBackend();
    try {
      // Verdict probe: initial VERDICT with only repo/path, no head.
      await expectCode(
        repo.fileObligation({
          id: "v-1",
          kind: "VERDICT",
          filedAt: T0,
          source: src("results/chatgpt"),
          retentionDisposition: "x",
        }),
        CODES.MISSING_SOURCE_BINDING,
      );
    } finally {
      await db.close();
    }
  });
});

describe("TB-004: handoff replay compares the complete step identity", () => {
  afterAll(cleanupTempDirs);
  const T3 = "2026-10-14T17:10:00Z";
  const T4 = "2026-10-14T17:15:00Z";

  async function fullHandoff(handoffs, id = "h-1") {
    await handoffs.beginHandoff(id, { actor: "Muse", recordedAt: T0, reason: "t" });
    await handoffs.writeOutcome(id, { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
    await handoffs.verifyReadback(id, { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
    await handoffs.updateQueue(id, { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
    return handoffs.completeHandoff(id, { actor: "Muse", recordedAt: T4, reason: "c" });
  }

  it30("a queue replay with a changed commit/blob is rejected; the stored queue is untouched", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await handoffs.beginHandoff("h-1", { actor: "Muse", recordedAt: T0, reason: "t" });
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await handoffs.verifyReadback("h-1", { verifier: "Muse", verifiedAt: T2, reason: "v", artifact: artifact() });
      await handoffs.updateQueue("h-1", { actor: "Muse", recordedAt: T3, reason: "q", queue: queueRef() });
      const eventsBefore = await handoffs.getEvents("h-1");
      // Verdict probe: replay updateQueue with a DIFFERENT commit/blob.
      await expect(
        handoffs.updateQueue("h-1", {
          actor: "Muse",
          recordedAt: T3,
          reason: "q-retry",
          queue: queueRef({ commit: "commitF", blob: "blob0" }),
        }),
      ).rejects.toMatchObject({ code: CODES.CONFLICTING_REPLAY });
      const h = await handoffs.getHandoff("h-1");
      expect(h.state).toBe("QUEUE_UPDATED");
      expect(h.queue.commit).toBe("def456"); // stored queue unchanged
      expect(h.queue.blob).toBe("blob456");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
      // Exact replay with the identical binding and actor is idempotent.
      const replayed = await handoffs.updateQueue("h-1", {
        actor: "Muse",
        recordedAt: T3,
        reason: "q-retry",
        queue: queueRef(),
      });
      expect(replayed.state).toBe("QUEUE_UPDATED");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
    } finally {
      await db.close();
    }
  });

  it30("a replay with changed attribution is rejected", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await handoffs.beginHandoff("h-1", { actor: "Muse", recordedAt: T0, reason: "t" });
      await handoffs.writeOutcome("h-1", { actor: "Muse", recordedAt: T1, reason: "w", artifact: artifact() });
      await expect(
        handoffs.writeOutcome("h-1", { actor: "SomeoneElse", recordedAt: T1, reason: "w", artifact: artifact() }),
      ).rejects.toMatchObject({ code: CODES.CONFLICTING_REPLAY });
    } finally {
      await db.close();
    }
  });

  it30("exact replay after later committed progress returns current state without a new event", async () => {
    const { db, handoffs } = await freshBackend();
    try {
      await fullHandoff(handoffs, "h-1");
      const eventsBefore = await handoffs.getEvents("h-1");
      // Verdict probe: after COMPLETE, exact replay of the original writeOutcome.
      const replayed = await handoffs.writeOutcome("h-1", {
        actor: "Muse",
        recordedAt: T1,
        reason: "w",
        artifact: artifact(),
      });
      expect(replayed.state).toBe("COMPLETE");
      expect(await handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
      // A conflicting writeOutcome after completion is rejected, not a skip.
      await expect(
        handoffs.writeOutcome("h-1", {
          actor: "Muse",
          recordedAt: T1,
          reason: "w",
          artifact: artifact({ commit: "other" }),
        }),
      ).rejects.toMatchObject({ code: CODES.CONFLICTING_REPLAY });
    } finally {
      await db.close();
    }
  });

  it30("replay survives restart: the committed history is the source of truth", async () => {
    const dir = tempDir("tb-r2-ac20-");
    const first = await freshBackend(dir);
    await fullHandoff(first.handoffs, "h-1");
    await first.db.close();
    const second = await freshBackend(dir);
    try {
      const eventsBefore = await second.handoffs.getEvents("h-1");
      const replayed = await second.handoffs.updateQueue("h-1", {
        actor: "Muse",
        recordedAt: T3,
        reason: "q-retry",
        queue: queueRef(),
      });
      expect(replayed.state).toBe("COMPLETE");
      expect(await second.handoffs.getEvents("h-1")).toHaveLength(eventsBefore.length);
    } finally {
      await second.db.close();
    }
  });
});

describe("TB-006: schema enforces dependency and timestamp invariants", () => {
  afterAll(cleanupTempDirs);

  it30("filing with an unknown dependency is rejected and persists nothing", async () => {
    const { db, repo } = await freshBackend();
    try {
      // Verdict probe 1: dependencies:['missing-record'].
      await expectCode(
        repo.fileObligation(taskRecord("t-1", T0, { dependencies: ["missing-record"] })),
        CODES.UNKNOWN_OBLIGATION,
      );
      await expectCode(repo.getObligation("t-1"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await db.close();
    }
  });

  it30("direct SQL self-link and bad-timestamp writes are refused by the schema", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      // Verdict probe 2: direct self-dependency edge insert.
      await expect(
        db.query("insert into team_brain_obligation_dependencies (obligation_id, depends_on_id) values ('t-1','t-1')"),
      ).rejects.toThrow();
      // Verdict probe 3: direct invalid calendar timestamp.
      await expect(
        db.query("update team_brain_obligations set filed_at = '2026-02-30T16:00:00Z' where obligation_id = 't-1'"),
      ).rejects.toThrow();
      await expect(
        db.query("update team_brain_obligations set filed_at = 'not-a-timestamp' where obligation_id = 't-1'"),
      ).rejects.toThrow();
      // The row is untouched.
      expect((await repo.getObligation("t-1")).filedAt).toBe(T0);
    } finally {
      await db.close();
    }
  });

  it30("valid dependencies persist across restart and the projection is unchanged", async () => {
    const dir = tempDir("tb-r2-ac06-");
    const first = await freshBackend(dir);
    await first.repo.fileObligation(taskRecord("t-1", "2026-10-14T16:00:00Z"));
    await first.repo.fileObligation(taskRecord("t-2", "2026-10-14T16:30:00Z", { dependencies: ["t-1"] }));
    await first.db.close();
    const second = await freshBackend(dir);
    try {
      const list = await second.repo.listObligations();
      expect(list.find((o) => o.id === "t-2").dependencies).toEqual(["t-1"]);
      // Batch filing supports forward references atomically.
      await second.repo.fileObligationBatch([
        taskRecord("t-3", "2026-10-14T17:00:00Z", { dependencies: ["t-4"] }),
        taskRecord("t-4", "2026-10-14T17:05:00Z"),
      ]);
      expect((await second.repo.getObligation("t-3")).dependencies).toEqual(["t-4"]);
      // A batch with a truly unknown dependency fails atomically.
      await expect(
        second.repo.fileObligationBatch([
          taskRecord("t-5", "2026-10-14T18:00:00Z", { dependencies: ["ghost"] }),
          taskRecord("t-6", "2026-10-14T18:05:00Z"),
        ]),
      ).rejects.toThrow();
      await expectCode(second.repo.getObligation("t-5"), CODES.UNKNOWN_OBLIGATION);
      await expectCode(second.repo.getObligation("t-6"), CODES.UNKNOWN_OBLIGATION);
    } finally {
      await second.db.close();
    }
  });

  it30("direct SQL against a fresh database enforces the timestamp function", async () => {
    const db = new PGlite();
    try {
      const { readFileSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const here = dirname(fileURLToPath(import.meta.url));
      await db.exec(readFileSync(join(here, "..", "migrations", "001_team_brain_schema.sql"), "utf8"));
      const ok = await db.query("select team_brain_is_valid_utc_iso('2026-10-14T16:00:00Z') as v");
      expect(ok.rows[0].v).toBe(true);
      const okMs = await db.query("select team_brain_is_valid_utc_iso('2026-10-14T16:00:00.123Z') as v");
      expect(okMs.rows[0].v).toBe(true);
      for (const bad of ["2026-02-30T16:00:00Z", "2026-10-14 16:00:00", "yesterday", "2026-13-01T00:00:00Z", null]) {
        const r = await db.query("select team_brain_is_valid_utc_iso($1) as v", [bad]);
        expect(r.rows[0].v, bad).toBe(false);
      }
    } finally {
      await db.close();
    }
  });
});
