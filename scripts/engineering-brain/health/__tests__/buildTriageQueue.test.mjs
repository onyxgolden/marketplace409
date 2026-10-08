import { describe, expect, it } from "vitest";
import { buildTriageQueue } from "../buildTriageQueue.mjs";

function item(id, severity, confidence = "medium", lastSeen = null) {
  return { id, severity, confidence, lastSeen, kind: "coverage-gap", what: id, subsystem: "x", evidenceLinks: [] };
}

describe("buildTriageQueue", () => {
  it("orders by severity first: critical → high → medium → low", () => {
    const q = buildTriageQueue({
      prioritized: [
        item("a", "low"),
        item("b", "critical"),
        item("c", "medium"),
        item("d", "high"),
      ],
    });
    expect(q.map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("breaks severity ties by confidence: high → medium → low", () => {
    const q = buildTriageQueue({
      prioritized: [
        item("a", "high", "low"),
        item("b", "high", "high"),
        item("c", "high", "medium"),
      ],
    });
    expect(q.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks confidence ties by freshness: newer lastSeen first, null last", () => {
    const q = buildTriageQueue({
      prioritized: [
        item("a", "high", "high", null),
        item("b", "high", "high", "2026-10-01"),
        item("c", "high", "high", "2026-10-05"),
      ],
    });
    expect(q.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("uses lexicographic id as final stable tie-breaker", () => {
    const q = buildTriageQueue({
      prioritized: [item("zebra", "medium"), item("alpha", "medium"), item("mid", "medium")],
    });
    expect(q.map((x) => x.id)).toEqual(["alpha", "mid", "zebra"]);
  });

  it("is deterministic across input reorderings", () => {
    const base = [
      item("b", "high", "medium", "2026-10-02"),
      item("a", "critical", "high"),
      item("c", "high", "high", "2026-10-01"),
    ];
    const q1 = buildTriageQueue({ prioritized: base });
    const q2 = buildTriageQueue({ prioritized: [...base].reverse() });
    const q3 = buildTriageQueue({ prioritized: [base[2], base[0], base[1]] });
    expect(q1.map((x) => x.id)).toEqual(q2.map((x) => x.id));
    expect(q1.map((x) => x.id)).toEqual(q3.map((x) => x.id));
  });

  it("deduplicates exact duplicate ids but keeps independent findings", () => {
    const q = buildTriageQueue({
      prioritized: [
        item("dup", "high"),
        item("dup", "high"), // exact duplicate id
        item("dup-similar-text", "high"), // different id, similar text
      ],
    });
    const ids = q.map((x) => x.id);
    expect(ids.filter((i) => i === "dup").length).toBe(1);
    expect(ids).toContain("dup-similar-text");
  });

  it("stable ids survive refresh: same finding id maps to same queue position inputs", () => {
    const mk = () => [
      item("coverage:x", "high", "high", "2026-10-03"),
      item("coverage:y", "medium", "medium"),
    ];
    const q1 = buildTriageQueue({ prioritized: mk() });
    const q2 = buildTriageQueue({ prioritized: mk() });
    expect(q1.map((x) => x.id)).toEqual(q2.map((x) => x.id));
  });

  it("skips items without ids", () => {
    const q = buildTriageQueue({ prioritized: [item("ok", "high"), { severity: "high" }, null] });
    expect(q.map((x) => x.id)).toEqual(["ok"]);
  });

  it("never produces a resolved state or resolved items", () => {
    const q = buildTriageQueue({ prioritized: [item("a", "high"), item("b", "low")] });
    for (const x of q) {
      expect(x.triageState === undefined || x.triageState !== "resolved").toBe(true);
    }
    // Absence from a later snapshot is not represented here at all —
    // the queue only contains present findings.
    expect(q.length).toBe(2);
  });
});
