import { describe, expect, it } from "vitest";
import { createMemoryBrainStore } from "../memoryStore.js";
import {
  extractiveGist,
  normalizeFactText,
  runConsolidation,
  selectReplayCandidates,
} from "../consolidation.js";

const NOW = new Date("2026-11-02T12:00:00Z");

function episode(store, ownerId, overrides = {}) {
  return store.appendEpisode(ownerId, {
    content: "chat turn",
    sessionId: "s-1",
    createdAt: "2026-11-02T10:00:00Z",
    ...overrides,
  });
}

describe("extractiveGist", () => {
  it("keeps the first sentences and caps at 280 chars", () => {
    expect(extractiveGist("First sentence. Second sentence.")).toBe("First sentence. Second sentence.");
    const long = `${"word ".repeat(100)}end.`;
    const gist = extractiveGist(long);
    expect(gist.length).toBeLessThanOrEqual(280);
    expect(gist.endsWith("...")).toBe(true);
  });
});

describe("normalizeFactText", () => {
  it("lowercases, collapses whitespace, and strips trailing periods", () => {
    expect(normalizeFactText("  Prefers  Morning   Planning. ")).toBe("prefers morning planning");
  });
});

describe("selectReplayCandidates (70/30 mix)", () => {
  it("takes 70% newest and 30% oldest", () => {
    const episodes = Array.from({ length: 10 }, (_, i) => ({
      id: `ep-${i}`,
      createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    }));
    const picked = selectReplayCandidates(episodes, { limit: 10, newFraction: 0.7 }).map((e) => e.id);
    expect(picked).toHaveLength(10);
    // 7 newest: ep-9..ep-3; 3 oldest: ep-0..ep-2.
    expect(picked.slice(0, 7)).toEqual(["ep-9", "ep-8", "ep-7", "ep-6", "ep-5", "ep-4", "ep-3"]);
    expect(picked.slice(7).sort()).toEqual(["ep-0", "ep-1", "ep-2"]);
  });
});

describe("runConsolidation promotion (A3)", () => {
  it("promotes an uncontested fact as inferred", async () => {
    const store = createMemoryBrainStore();
    await episode(store, "owner-a", {
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    const result = await runConsolidation(store, "owner-a", { now: NOW });
    expect(result.promoted).toBe(1);
    const entries = await store.listSemanticEntries("owner-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].salience).toBe("inferred");
    expect(entries[0].content).toBe("Prefers morning planning");
  });

  it("promotes an owner-stated fact as verified", async () => {
    const store = createMemoryBrainStore();
    await episode(store, "owner-a", {
      tags: ["owner_stated"],
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    await runConsolidation(store, "owner-a", { now: NOW });
    expect((await store.listSemanticEntries("owner-a"))[0].salience).toBe("verified");
  });

  it("promotes a fact seen in two episodes as verified", async () => {
    const store = createMemoryBrainStore();
    await episode(store, "owner-a", {
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    await episode(store, "owner-a", {
      sessionId: "s-2",
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    await runConsolidation(store, "owner-a", { now: NOW });
    const entries = await store.listSemanticEntries("owner-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].salience).toBe("verified");
  });

  it("merges a duplicate and is idempotent on rerun", async () => {
    const store = createMemoryBrainStore();
    await store.createSemanticEntry("owner-a", {
      content: "Prefers morning planning",
      factKey: "planning-time",
      salience: "inferred",
      provenanceSource: "owner note",
    });
    await episode(store, "owner-a", {
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    const first = await runConsolidation(store, "owner-a", { now: NOW });
    expect(first.merged).toBe(1);
    expect(first.promoted).toBe(0);
    const entry = (await store.listSemanticEntries("owner-a"))[0];
    expect(entry.provenanceSource).toContain("chat episode");
    const second = await runConsolidation(store, "owner-a", { now: NOW });
    expect(second).toMatchObject({ promoted: 0, merged: 0, conflictsFlagged: 0 });
  });
});

describe("runConsolidation conflicts (A3: never silently resolves)", () => {
  it("flags a same-key different-text conflict and touches nothing", async () => {
    const store = createMemoryBrainStore();
    await store.createSemanticEntry("owner-a", {
      content: "Prefers morning planning",
      factKey: "planning-time",
      salience: "owner_stated",
    });
    await episode(store, "owner-a", {
      candidateFacts: [{ key: "planning-time", text: "Prefers evening planning" }],
    });
    const result = await runConsolidation(store, "owner-a", { now: NOW });
    expect(result.conflictsFlagged).toBe(1);
    expect(result.promoted).toBe(0);
    const entries = await store.listSemanticEntries("owner-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Prefers morning planning");
    expect(entries[0].salience).toBe("owner_stated");
    const flags = await store.listFlags("owner-a", { resolved: false });
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe("conflict");
    // Rerun adds no duplicate flag.
    const rerun = await runConsolidation(store, "owner-a", { now: NOW });
    expect(rerun.conflictsFlagged).toBe(0);
    expect(await store.listFlags("owner-a", { resolved: false })).toHaveLength(1);
  });
});

describe("runConsolidation inferred decay (A4)", () => {
  it("flags an old uncorroborated inferred entry and leaves the rest", async () => {
    const store = createMemoryBrainStore();
    const old = await store.createSemanticEntry("owner-a", {
      content: "Old unconfirmed note",
      factKey: "old-note",
      salience: "inferred",
      provenanceAt: "2026-10-01T10:00:00Z",
    });
    await store.createSemanticEntry("owner-a", {
      content: "Old owner-stated note",
      factKey: "old-stated",
      salience: "owner_stated",
      provenanceAt: "2026-10-01T10:00:00Z",
    });
    await store.createSemanticEntry("owner-a", {
      content: "Corroborated old note",
      factKey: "shared-key",
      salience: "inferred",
      provenanceAt: "2026-10-01T10:00:00Z",
    });
    await store.createSemanticEntry("owner-a", {
      content: "Corroborated old note",
      factKey: "shared-key",
      salience: "inferred",
      provenanceAt: "2026-10-01T10:00:00Z",
    });
    const result = await runConsolidation(store, "owner-a", { now: NOW, decayDays: 7 });
    expect(result.decayFlagged).toBe(1);
    const entries = await store.listSemanticEntries("owner-a");
    expect(entries.find((e) => e.id === old.id).decayFlagged).toBe(true);
    expect(entries.filter((e) => e.decayFlagged)).toHaveLength(1);
    const flags = await store.listFlags("owner-a", { resolved: false });
    expect(flags.filter((f) => f.kind === "inferred_decay")).toHaveLength(1);
  });
});

describe("runConsolidation archiving (Q2)", () => {
  it("gists and archives old episodes but retains raw content", async () => {
    const store = createMemoryBrainStore();
    const old = await episode(store, "owner-a", {
      content: "Old turn about planning. Second sentence here.",
      createdAt: "2026-07-01T10:00:00Z",
    });
    await episode(store, "owner-a", { content: "Recent turn." });
    const result = await runConsolidation(store, "owner-a", { now: NOW, archiveWindowDays: 90 });
    expect(result.archived).toBe(1);
    const episodes = await store.listEpisodes("owner-a");
    const archived = episodes.find((e) => e.id === old.id);
    expect(archived.status).toBe("archived");
    expect(archived.contentGist).toBe("Old turn about planning. Second sentence here.");
    expect(archived.content).toBe("Old turn about planning. Second sentence here.");
    expect(archived.archiveStoragePath).toBe(`brain-archives/owner-a/${old.id}.txt`);
    expect(episodes.find((e) => e.content === "Recent turn.").status).toBe("active");
  });

  it("never deletes rows", async () => {
    const store = createMemoryBrainStore();
    await episode(store, "owner-a", { content: "Old turn.", createdAt: "2026-07-01T10:00:00Z" });
    await store.createSemanticEntry("owner-a", {
      content: "Old note",
      factKey: "old",
      salience: "inferred",
      provenanceAt: "2026-07-01T10:00:00Z",
    });
    await runConsolidation(store, "owner-a", { now: NOW });
    expect(await store.listEpisodes("owner-a")).toHaveLength(1);
    expect(await store.listSemanticEntries("owner-a")).toHaveLength(1);
  });
});
