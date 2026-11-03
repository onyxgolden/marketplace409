import { describe, expect, it } from "vitest";
import { tokenize, scoreEntry, selectWorkingSet } from "../retrieval.js";

describe("tokenize", () => {
  it("lowercases, strips punctuation, and drops empties", () => {
    expect(tokenize("Morning Planning, twice!")).toEqual(["morning", "planning", "twice"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("scoreEntry", () => {
  it("ranks a matching entry above a non-matching one", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const hit = scoreEntry(
      { content: "prefers morning planning sessions", createdAt: "2026-11-02T10:00:00Z" },
      tokenize("morning planning"),
      now.getTime(),
    );
    const miss = scoreEntry(
      { content: "unrelated note about paint", createdAt: "2026-11-02T10:00:00Z" },
      tokenize("morning planning"),
      now.getTime(),
    );
    expect(hit.score).toBeGreaterThan(miss.score);
  });

  it("decays recency with age", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const fresh = scoreEntry(
      { content: "same words here", createdAt: "2026-11-02T10:00:00Z" },
      tokenize("same words here"),
      now.getTime(),
    );
    const old = scoreEntry(
      { content: "same words here", createdAt: "2026-08-02T10:00:00Z" },
      tokenize("same words here"),
      now.getTime(),
    );
    expect(fresh.recency).toBeGreaterThan(old.recency);
  });
});

describe("selectWorkingSet", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const stamp = "2026-11-02T10:00:00Z";

  it("respects the limit", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `e-${i}`,
      content: `note number ${i} about planning`,
      createdAt: stamp,
    }));
    expect(selectWorkingSet(entries, { query: "planning", now, limit: 8 })).toHaveLength(8);
  });

  it("is deterministic under shuffled input", () => {
    const entries = [
      { id: "a", content: "morning planning session", createdAt: stamp },
      { id: "b", content: "evening review notes", createdAt: stamp },
      { id: "c", content: "morning planning checklist", createdAt: stamp },
    ];
    const forward = selectWorkingSet(entries, { query: "morning planning", now, limit: 3 }).map((e) => e.id);
    const reversed = selectWorkingSet([...entries].reverse(), { query: "morning planning", now, limit: 3 }).map((e) => e.id);
    expect(forward).toEqual(reversed);
  });

  it("prefers a novel entry over a near-duplicate of the top pick", () => {
    const entries = [
      { id: "a-top", content: "alpha beta gamma", createdAt: stamp },
      { id: "b-dup", content: "alpha beta gamma", createdAt: stamp },
      { id: "c-novel", content: "alpha delta epsilon", createdAt: stamp },
    ];
    const picked = selectWorkingSet(entries, { query: "alpha beta gamma delta", now, limit: 2 }).map((e) => e.id);
    expect(picked).toEqual(["a-top", "c-novel"]);
  });
});
