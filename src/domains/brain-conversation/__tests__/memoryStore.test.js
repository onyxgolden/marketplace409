import { describe, expect, it } from "vitest";
import { createMemoryBrainStore, BRAIN_NOT_FOUND_MESSAGE } from "../memoryStore.js";

describe("memory store owner isolation (A1)", () => {
  it("never lists another owner's rows", async () => {
    const store = createMemoryBrainStore();
    await store.createSemanticEntry("owner-a", { content: "A's note", salience: "owner_stated" });
    await store.createSemanticEntry("owner-b", { content: "B's note", salience: "owner_stated" });
    const aRows = await store.listSemanticEntries("owner-a");
    expect(aRows).toHaveLength(1);
    expect(aRows[0].content).toBe("A's note");
    const bRows = await store.listSemanticEntries("owner-b");
    expect(bRows).toHaveLength(1);
    expect(bRows[0].content).toBe("B's note");
  });

  it("reports cross-owner update/delete as plain not-found", async () => {
    const store = createMemoryBrainStore();
    const entry = await store.createSemanticEntry("owner-a", { content: "A's note" });
    await expect(store.updateSemanticEntry("owner-b", entry.id, { content: "hijack" })).rejects.toThrow(
      BRAIN_NOT_FOUND_MESSAGE,
    );
    await expect(store.deleteSemanticEntry("owner-b", entry.id)).rejects.toThrow(BRAIN_NOT_FOUND_MESSAGE);
    // The row survives untouched.
    expect((await store.listSemanticEntries("owner-a"))[0].content).toBe("A's note");
  });

  it("uses synthetic ids, never UUIDs", async () => {
    const store = createMemoryBrainStore();
    const entry = await store.createSemanticEntry("owner-a", { content: "note" });
    expect(entry.id).toMatch(/^brain-synth-\d+$/);
  });
});

describe("memory store behavior", () => {
  it("appends episodes newest-first and keeps them append-only", async () => {
    const store = createMemoryBrainStore();
    const first = await store.appendEpisode("owner-a", {
      content: "first turn",
      sessionId: "s-1",
      createdAt: "2026-11-01T10:00:00Z",
    });
    await store.appendEpisode("owner-a", {
      content: "second turn",
      sessionId: "s-1",
      createdAt: "2026-11-01T11:00:00Z",
    });
    const episodes = await store.listEpisodes("owner-a");
    expect(episodes.map((e) => e.content)).toEqual(["second turn", "first turn"]);
    await store.correctEpisode("owner-a", first.id, "actually it was morning");
    const corrections = await store.listEpisodeCorrections("owner-a", first.id);
    expect(corrections).toHaveLength(1);
    expect((await store.listEpisodes("owner-a")).find((e) => e.id === first.id).content).toBe("first turn");
  });

  it("confirms procedures and stores preferences", async () => {
    const store = createMemoryBrainStore();
    const procedure = await store.createProcedure("owner-a", { title: "Close out", steps: "Step one. Step two." });
    expect(procedure.confirmed).toBe(false);
    expect((await store.confirmProcedure("owner-a", procedure.id)).confirmed).toBe(true);
    await store.setPreference("owner-a", "inferred_decay_days", 14);
    expect(await store.getPreference("owner-a", "inferred_decay_days")).toBe(14);
    expect(await store.getPreference("owner-a", "missing_key")).toBeNull();
  });

  it("adds, lists, and resolves flags", async () => {
    const store = createMemoryBrainStore();
    const flag = await store.addFlag("owner-a", {
      kind: "conflict",
      subjectType: "semantic",
      subjectId: "some-entry",
      detail: "Conflict noted.",
    });
    expect(flag.resolved).toBe(false);
    expect(await store.listFlags("owner-a", { resolved: false })).toHaveLength(1);
    await store.resolveFlag("owner-a", flag.id);
    expect(await store.listFlags("owner-a", { resolved: false })).toHaveLength(0);
    expect(await store.listFlags("owner-a", { resolved: true })).toHaveLength(1);
  });
});
