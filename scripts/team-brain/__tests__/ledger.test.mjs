// Team Brain slice 1 — ledger acceptance tests (criteria 1-6).
// Run with the repo's normal runner: npx vitest run scripts/team-brain

import { afterAll, describe, expect, it } from "vitest";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);
import { CODES, TeamBrainError } from "../ledger/errors.mjs";
import { freshBackend, src, taskRecord, tempDir, T0, cleanupTempDirs } from "./helpers.mjs";

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ name: "TeamBrainError", code });
}

describe("ledger invariants", () => {
  afterAll(cleanupTempDirs);
  it30("AC-01a: a task close without completion evidence is rejected", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await repo.recordVerification("t-1", {
        verifier: "Muse",
        verifiedAt: "2026-10-14T17:00:00Z",
        reason: "verified",
        evidenceRefs: ["blob:e1"],
      });
      await expectCode(
        repo.closeTask("t-1", { actor: "Muse", recordedAt: "2026-10-14T17:01:00Z", reason: "close", evidenceRefs: [] }),
        CODES.MISSING_EVIDENCE,
      );
      expect((await repo.getObligation("t-1")).state).toBe("OPEN");
    } finally {
      await db.close();
    }
  });

  it30("AC-01b: a close with evidence but no verification is rejected", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await expectCode(
        repo.closeTask("t-1", {
          actor: "Muse",
          recordedAt: "2026-10-14T17:01:00Z",
          reason: "close",
          evidenceRefs: ["blob:e1"],
        }),
        CODES.NO_VERIFICATION,
      );
      expect((await repo.getObligation("t-1")).state).toBe("OPEN");
    } finally {
      await db.close();
    }
  });

  it30("AC-01c: evidence plus a recorded verification event closes the task", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await repo.recordVerification("t-1", {
        verifier: "Muse",
        verifiedAt: "2026-10-14T17:00:00Z",
        reason: "verified against blob",
        evidenceRefs: ["blob:e1"],
      });
      const closed = await repo.closeTask("t-1", {
        actor: "Muse",
        recordedAt: "2026-10-14T17:01:00Z",
        reason: "done",
        evidenceRefs: ["blob:e1"],
      });
      expect(closed.state).toBe("CLOSED");
      const events = await repo.getEvents("t-1");
      expect(events.map((e) => e.eventType)).toEqual(["FILED", "VERIFICATION", "CLOSED"]);
    } finally {
      await db.close();
    }
  });

  it30("AC-02: clock advancement alone never closes, expires, or deletes any obligation", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation(taskRecord("t-1"));
      await repo.fileObligation({
        id: "a-1",
        kind: "AUTHORIZATION",
        filedAt: T0,
        source: src("scripts/team-brain/README.md"),
        retentionDisposition: "stands until explicitly revoked",
        filedBy: "Jason",
        filedReason: "standing order",
      });
      // No lifecycle calls at all — time passing is not an input to the API.
      // And the API surface has no deletion, expiry, or TTL path by design.
      expect(repo.delete).toBeUndefined();
      expect(repo.expire).toBeUndefined();
      expect(repo.expireAuthorization).toBeUndefined();
      expect(repo.garbageCollect).toBeUndefined();
      expect(repo.setTtl).toBeUndefined();
      const later = await repo.listObligations();
      expect(later.map((o) => `${o.id}:${o.state}`).sort()).toEqual(["a-1:OPEN", "t-1:OPEN"]);
      // A second close attempt after close is a terminal-state rejection, not a clock effect.
      await repo.recordVerification("t-1", {
        verifier: "Muse",
        verifiedAt: "2026-10-15T17:00:00Z",
        reason: "verified",
        evidenceRefs: ["blob:e1"],
      });
      await repo.closeTask("t-1", {
        actor: "Muse",
        recordedAt: "2026-10-16T17:00:00Z",
        reason: "done",
        evidenceRefs: ["blob:e1"],
      });
      await expectCode(
        repo.closeTask("t-1", {
          actor: "Muse",
          recordedAt: "2026-10-17T17:00:00Z",
          reason: "again",
          evidenceRefs: ["blob:e1"],
        }),
        CODES.ALREADY_TERMINAL,
      );
    } finally {
      await db.close();
    }
  });

  it30("AC-03: an authorization remains effective across restart until explicit revocation", async () => {
    const dir = tempDir("tb-ac03-");
    const first = await freshBackend(dir);
    await first.repo.fileObligation({
      id: "a-1",
      kind: "AUTHORIZATION",
      filedAt: T0,
      source: src("scripts/team-brain/README.md"),
      retentionDisposition: "stands until explicitly revoked",
      filedBy: "Jason",
      filedReason: "standing order",
    });
    await first.db.close();

    const second = await freshBackend(dir);
    try {
      expect((await second.repo.getObligation("a-1")).state).toBe("OPEN");
      const events = await second.repo.getEvents("a-1");
      expect(events.map((e) => e.eventType)).toEqual(["FILED"]);
      const revoked = await second.repo.revokeAuthorization("a-1", {
        actor: "Jason",
        recordedAt: "2026-10-15T12:00:00Z",
        reason: "order withdrawn",
      });
      expect(revoked.state).toBe("REVOKED");
    } finally {
      await second.db.close();
    }
  });

  it30("AC-04a: a verdict stands until a newer verdict supersedes it at a new head", async () => {
    const { db, repo } = await freshBackend();
    try {
      const v1 = await repo.fileObligation({
        id: "v-1",
        kind: "VERDICT",
        filedAt: T0,
        source: src("results/chatgpt", { commit: "aaa111", blob: "blob-v1", head: "aaa111" }),
        retentionDisposition: "current until superseded at a new head",
        filedBy: "ChatGPT",
        filedReason: "review verdict",
      });
      const before = JSON.stringify({ ...v1, state: undefined, supersededBy: undefined });
      const { old, next } = await repo.supersedeVerdict(
        "v-1",
        {
          id: "v-2",
          filedAt: "2026-10-14T18:00:00Z",
          source: src("results/chatgpt", { commit: "bbb222", blob: "blob-v2", head: "bbb222" }),
          retentionDisposition: "current until superseded at a new head",
          filedBy: "ChatGPT",
          filedReason: "re-review verdict",
        },
        { actor: "ChatGPT", recordedAt: "2026-10-14T18:00:00Z", reason: "new reviewed head" },
      );
      expect(old.state).toBe("SUPERSEDED");
      expect(old.supersededBy).toBe("v-2");
      expect(next.state).toBe("OPEN");
      expect(next.source.head).toBe("bbb222");
      expect(next.supersedes).toBe("v-1");
      // The old record is never rewritten: content fields identical.
      const after = JSON.stringify({ ...old, state: undefined, supersededBy: undefined });
      expect(after).toBe(before);
    } finally {
      await db.close();
    }
  });

  it30("AC-04b: same-head supersession is rejected", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation({
        id: "v-1",
        kind: "VERDICT",
        filedAt: T0,
        source: src("results/chatgpt", { commit: "aaa111", blob: "blob-v1", head: "aaa111" }),
        retentionDisposition: "current until superseded at a new head",
        filedBy: "ChatGPT",
        filedReason: "review verdict",
      });
      await expectCode(
        repo.supersedeVerdict(
          "v-1",
          {
            id: "v-2",
            filedAt: "2026-10-14T18:00:00Z",
            source: src("results/chatgpt", { commit: "aaa111", blob: "blob-v1b", head: "aaa111" }),
            retentionDisposition: "current until superseded at a new head",
          },
          { actor: "ChatGPT", recordedAt: "2026-10-14T18:00:00Z", reason: "re-file same head" },
        ),
        CODES.SAME_HEAD_SUPERSESSION,
      );
      expect((await repo.getObligation("v-1")).state).toBe("OPEN");
    } finally {
      await db.close();
    }
  });

  it30("AC-05: evidence and prior events are unchanged after correction", async () => {
    const { db, repo } = await freshBackend();
    try {
      await repo.fileObligation({
        id: "e-1",
        kind: "EVIDENCE",
        filedAt: T0,
        source: src("scripts/team-brain/fixtures/basic.json", { commit: "c1", blob: "b1", head: "c1" }),
        retentionDisposition: "immutable; corrections link, never rewrite",
        filedBy: "Muse",
        filedReason: "evidence",
      });
      const before = await repo.getObligation("e-1");
      const eventsBefore = await repo.getEvents("e-1");
      const { original, correction } = await repo.correctEvidence(
        "e-1",
        {
          id: "e-2",
          filedAt: "2026-10-14T17:00:00Z",
          source: src("scripts/team-brain/fixtures/basic.json", { commit: "c2", blob: "b2", head: "c2" }),
          retentionDisposition: "immutable; corrections link, never rewrite",
        },
        { actor: "Muse", recordedAt: "2026-10-14T17:00:00Z", reason: "corrected link" },
      );
      // Original content fields unchanged; only the linkage was appended.
      expect(original.source).toEqual(before.source);
      expect(original.filedAt).toBe(before.filedAt);
      expect(original.kind).toBe("EVIDENCE");
      expect(correction.supersedes).toBe("e-1");
      expect(original.supersededBy).toBe("e-2");
      const eventsAfter = await repo.getEvents("e-1");
      expect(eventsAfter.length).toBe(eventsBefore.length + 1);
      expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore);
      expect(eventsAfter[eventsAfter.length - 1].eventType).toBe("CORRECTION_FILED");
    } finally {
      await db.close();
    }
  });

  it30("AC-06: restart from the same durable PGlite directory preserves records and event order", async () => {
    const dir = tempDir("tb-ac06-");
    const first = await freshBackend(dir);
    await first.repo.fileObligation(taskRecord("t-1", "2026-10-14T16:00:00Z"));
    await first.repo.fileObligation(taskRecord("t-2", "2026-10-14T16:30:00Z", { dependencies: ["t-1"] }));
    await first.repo.recordVerification("t-1", {
      verifier: "Muse",
      verifiedAt: "2026-10-14T17:00:00Z",
      reason: "v",
      evidenceRefs: ["blob:e1"],
    });
    await first.repo.appendAnnotation("t-2", {
      actor: "Muse",
      recordedAt: "2026-10-14T17:05:00Z",
      eventType: "NOTE",
      reason: "note",
    });
    const before = await first.repo.listObligations();
    const eventsBefore = await first.repo.getEvents("t-1");
    await first.db.close();

    const second = await freshBackend(dir);
    try {
      const after = await second.repo.listObligations();
      expect(after).toEqual(before);
      const eventsAfter = await second.repo.getEvents("t-1");
      expect(eventsAfter).toEqual(eventsBefore);
      expect(eventsAfter.map((e) => e.eventType)).toEqual(["FILED", "VERIFICATION"]);
    } finally {
      await second.db.close();
    }
  });

  it30("ledger schema rejects self-dependencies, duplicates, and malformed timestamps", async () => {
    const { db, repo } = await freshBackend();
    try {
      await expectCode(repo.fileObligation(taskRecord("t-1", T0, { dependencies: ["t-1"] })), CODES.SELF_DEPENDENCY);
      await repo.fileObligation(taskRecord("t-1"));
      await expectCode(repo.fileObligation(taskRecord("t-1")), CODES.DUPLICATE_OBLIGATION);
      await expectCode(repo.fileObligation(taskRecord("t-2", "2026-10-14 16:00:00")), CODES.MALFORMED_TIMESTAMP);
      await expectCode(repo.fileObligation(taskRecord("t-3", "2026-02-30T00:00:00Z")), CODES.MALFORMED_TIMESTAMP);
      expect(repo.fileObligation).toBeTypeOf("function");
      expect(TeamBrainError).toBeTypeOf("function");
    } finally {
      await db.close();
    }
  });
});
