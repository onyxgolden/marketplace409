// Team Brain slice 1 — queue projection acceptance tests (criteria 7-15).
// The projection is pure: fixed inputs + injected `now`, no I/O, no clock.

import { describe, expect, it } from "vitest";
import { CODES } from "../ledger/errors.mjs";
import { FOUR_HOURS_MS, projectQueue } from "../queue/projection.mjs";

function item(id, filedAt, extra = {}) {
  return { id, kind: "TASK", filedAt, state: "OPEN", deps: [], ...extra };
}

const NOW = "2026-10-14T19:00:00Z";

describe("queue semantics", () => {
  it("AC-07: shuffled insertion yields identical oldest-first output; ties break on id", () => {
    const mk = () => [
      item("q-c", "2026-10-14T12:00:00Z"),
      item("q-a", "2026-10-14T10:00:00Z"),
      item("q-b", "2026-10-14T10:00:00Z"),
      item("q-d", "2026-10-14T14:00:00Z"),
    ];
    const r1 = projectQueue({ obligations: mk(), now: NOW });
    const r2 = projectQueue({ obligations: [...mk()].reverse(), now: NOW });
    expect(r1.ordered).toEqual(["q-a", "q-b", "q-c", "q-d"]);
    expect(r2.ordered).toEqual(r1.ordered);
    expect(r1.blocked).toEqual([]);
  });

  it("AC-08: a direct dependency inherits the blocked item's earlier age", () => {
    // a (10:00) blocked on b (12:00); c filed 11:00 with no deps.
    const obligations = [
      item("a", "2026-10-14T10:00:00Z", { deps: ["b"] }),
      item("b", "2026-10-14T12:00:00Z"),
      item("c", "2026-10-14T11:00:00Z"),
    ];
    const r = projectQueue({ obligations, now: NOW });
    expect(r.blocked.map((b) => b.id)).toEqual(["a"]);
    expect(r.blocked[0].blockedBy).toEqual(["b"]);
    // b inherits a's 10:00 effective age, so b sorts ahead of c (11:00).
    expect(r.ordered).toEqual(["b", "c"]);
    // Oldest open item: a and b tie at effective 10:00 (a is blocked but
    // still open); the stable id tie-break picks a.
    expect(r.oldest.id).toBe("a");
    expect(r.oldestAgeMs).toBe(Date.parse(NOW) - Date.parse("2026-10-14T10:00:00Z"));
  });

  it("AC-09: transitive and fan-in dependencies inherit the earliest descendant age exactly once", () => {
    // a(09:00) -> b(11:00) -> c(13:00); d(12:00) -> c. c inherits 09:00.
    const obligations = [
      item("a", "2026-10-14T09:00:00Z", { deps: ["b"] }),
      item("b", "2026-10-14T11:00:00Z", { deps: ["c"] }),
      item("c", "2026-10-14T13:00:00Z"),
      item("d", "2026-10-14T12:00:00Z", { deps: ["c"] }),
      item("e", "2026-10-14T10:00:00Z"),
    ];
    const r1 = projectQueue({ obligations, now: NOW });
    const r2 = projectQueue({ obligations: [...obligations].reverse(), now: NOW });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2)); // deterministic
    expect(r1.blocked.map((b) => b.id)).toEqual(["a", "b", "d"]);
    // c inherits 09:00 (the earliest descendant age) and sorts first among
    // actionable items. Oldest open item: a and c tie at effective 09:00
    // (a is blocked but still open); the stable id tie-break picks a.
    expect(r1.ordered).toEqual(["c", "e"]);
    expect(r1.oldest.id).toBe("a");
    expect(r1.oldestAgeMs).toBe(Date.parse(NOW) - Date.parse("2026-10-14T09:00:00Z"));
  });

  it("AC-10: a dependency cycle fails closed with a stable diagnostic", () => {
    const obligations = [item("x", "2026-10-14T10:00:00Z", { deps: ["y"] }), item("y", "2026-10-14T11:00:00Z", { deps: ["x"] })];
    let err1, err2;
    try {
      projectQueue({ obligations, now: NOW });
    } catch (e) {
      err1 = e;
    }
    try {
      projectQueue({ obligations: [...obligations].reverse(), now: NOW });
    } catch (e) {
      err2 = e;
    }
    for (const err of [err1, err2]) {
      expect(err).toMatchObject({ name: "TeamBrainError", code: CODES.CYCLE_DETECTED });
      expect(err.details.cycle).toEqual(["x", "y"]);
    }
    expect(err1.message).toBe(err2.message);
  });

  it("AC-11: unattributed, partially attributed, and non-Jason overrides are rejected", () => {
    const base = [item("a", "2026-10-14T10:00:00Z"), item("b", "2026-10-14T11:00:00Z")];
    const cases = [
      ["unattributed", { rank: 0, recordedAt: NOW, reason: "why", authority: "Jason" }, CODES.INVALID_OVERRIDE],
      ["partially attributed", { rank: 0, actor: "Muse", recordedAt: NOW, authority: "Jason" }, CODES.INVALID_OVERRIDE],
      ["non-Jason authority", { rank: 0, actor: "Muse", recordedAt: NOW, reason: "why", authority: "ChatGPT" }, CODES.INVALID_OVERRIDE],
      ["malformed time", { rank: 0, actor: "Muse", recordedAt: "yesterday", reason: "why", authority: "Jason" }, CODES.MALFORMED_TIMESTAMP],
    ];
    for (const [label, override, code] of cases) {
      expect(() => projectQueue({ obligations: [base[0], { ...base[1], override }], now: NOW }), label).toThrowError(
        expect.objectContaining({ code }),
      );
    }
  });

  it("AC-12: a valid override records who/when/why/authority and reorders per the documented comparator", () => {
    const obligations = [
      item("old", "2026-10-14T08:00:00Z"),
      item("new", "2026-10-14T15:00:00Z", {
        override: {
          rank: 0,
          actor: "Muse",
          recordedAt: "2026-10-14T16:00:00Z",
          reason: "Jason pinned this to the front",
          authority: "Jason Morgan (direct word)",
        },
      }),
      item("mid", "2026-10-14T12:00:00Z", {
        override: {
          rank: 1,
          actor: "Muse",
          recordedAt: "2026-10-14T16:05:00Z",
          reason: "Jason second priority",
          authority: "Jason",
        },
      }),
    ];
    const r = projectQueue({ obligations, now: NOW });
    expect(r.ordered).toEqual(["new", "mid", "old"]);
    expect(r.overrides).toEqual([
      {
        id: "new",
        actor: "Muse",
        recordedAt: "2026-10-14T16:00:00Z",
        reason: "Jason pinned this to the front",
        authority: "Jason Morgan (direct word)",
        rank: 0,
      },
      {
        id: "mid",
        actor: "Muse",
        recordedAt: "2026-10-14T16:05:00Z",
        reason: "Jason second priority",
        authority: "Jason",
        rank: 1,
      },
    ]);
  });

  it("AC-13: at exactly four hours no action is due; just after, one re-ping is due", () => {
    const at4h = "2026-10-14T15:00:00Z"; // NOW - 4h exactly
    const justOver = "2026-10-14T14:59:59Z";
    const r = projectQueue({
      obligations: [item("exact", at4h), item("over", justOver)],
      now: NOW,
    });
    expect(r.escalations).toEqual([{ id: "over", action: "REPING_DUE", ageMs: FOUR_HOURS_MS + 1000 }]);
  });

  it("AC-14: after the re-ping event one report-to-Jason is due; no duplicates on repeated reads", () => {
    const mk = () => [item("s", "2026-10-14T10:00:00Z", { repingSent: true })];
    const r1 = projectQueue({ obligations: mk(), now: NOW });
    expect(r1.escalations).toEqual([
      { id: "s", action: "REPORT_TO_JASON_DUE", ageMs: 9 * 60 * 60 * 1000 },
    ]);
    const r2 = projectQueue({ obligations: mk(), now: NOW });
    expect(r2.escalations).toEqual(r1.escalations); // no duplicate actions
    const r3 = projectQueue({ obligations: [item("s", "2026-10-14T10:00:00Z", { repingSent: true, reportSent: true })], now: NOW });
    expect(r3.escalations).toEqual([]); // chain complete: nothing further due
  });

  it("AC-15: nonempty status reports the oldest item and age; empty reports none", () => {
    const r = projectQueue({
      obligations: [item("a", "2026-10-14T10:00:00Z"), item("b", "2026-10-14T11:00:00Z")],
      now: NOW,
    });
    expect(r.oldest).toEqual({ id: "a", kind: "TASK" });
    expect(r.oldestAgeMs).toBe(9 * 60 * 60 * 1000);
    const empty = projectQueue({ obligations: [], now: NOW });
    expect(empty.oldest).toBeNull();
    expect(empty.oldestAgeMs).toBeNull();
    expect(empty.ordered).toEqual([]);
    expect(empty.escalations).toEqual([]);
  });

  it("closed dependencies satisfy a blocked item; unknown deps block with a reason", () => {
    const r = projectQueue({
      obligations: [
        item("a", "2026-10-14T10:00:00Z", { deps: ["done"] }),
        item("done", "2026-10-14T09:00:00Z", { state: "CLOSED" }),
        item("b", "2026-10-14T11:00:00Z", { deps: ["ghost"] }),
      ],
      now: NOW,
    });
    expect(r.blocked.map((b) => b.id)).toEqual(["b"]);
    expect(r.blocked[0].reason).toContain("ghost");
    expect(r.ordered).toEqual(["a"]);
  });
});
