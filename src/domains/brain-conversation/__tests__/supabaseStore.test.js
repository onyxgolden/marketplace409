import { describe, expect, it } from "vitest";
import { createSupabaseBrainStore } from "../supabaseStore.js";

// Chainable fake: every chain method returns the builder; terminal methods
// resolve with the preset result. All calls are recorded for assertions.
function chainable(result, calls) {
  const builder = {
    select: (...args) => {
      calls.push(["select", ...args]);
      return builder;
    },
    eq: (column, value) => {
      calls.push(["eq", column, value]);
      return builder;
    },
    order: (column, options) => {
      calls.push(["order", column, options]);
      return builder;
    },
    insert: (row) => {
      calls.push(["insert", row]);
      return builder;
    },
    update: (row) => {
      calls.push(["update", row]);
      return builder;
    },
    delete: () => {
      calls.push(["delete"]);
      return builder;
    },
    upsert: (row, options) => {
      calls.push(["upsert", row, options]);
      return builder;
    },
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function fakeSupabase(result, calls) {
  return { from: () => chainable(result, calls) };
}

const SEMANTIC_ROW = {
  id: "row-1",
  owner_id: "owner-a",
  content: "Prefers morning planning",
  fact_key: "planning-time",
  salience: "owner_stated",
  provenance_source: "owner note",
  provenance_at: "2026-11-01T10:00:00Z",
  record_type: null,
  record_id: null,
  decay_flagged: false,
  decay_flagged_at: null,
  superseded_by: null,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
};

describe("supabase store owner scoping", () => {
  it("scopes every list query by owner_id", async () => {
    const calls = [];
    const store = createSupabaseBrainStore(fakeSupabase({ data: [SEMANTIC_ROW], error: null }, calls));
    const entries = await store.listSemanticEntries("owner-a");
    expect(entries).toHaveLength(1);
    expect(entries[0].factKey).toBe("planning-time");
    expect(entries[0].ownerId).toBe("owner-a");
    expect(calls).toContainEqual(["eq", "owner_id", "owner-a"]);
  });

  it("writes the owner_id on insert", async () => {
    const calls = [];
    const store = createSupabaseBrainStore(fakeSupabase({ data: SEMANTIC_ROW, error: null }, calls));
    await store.createSemanticEntry("owner-a", { content: "note", salience: "inferred" });
    const insert = calls.find(([name]) => name === "insert");
    expect(insert[1].owner_id).toBe("owner-a");
  });

  it("treats an empty update result as not-found (cross-owner reads as missing)", async () => {
    const calls = [];
    const store = createSupabaseBrainStore(fakeSupabase({ data: [], error: null }, calls));
    await expect(store.updateSemanticEntry("owner-b", "row-1", { content: "hijack" })).rejects.toThrow(
      "Brain entry not found.",
    );
    expect(calls).toContainEqual(["eq", "owner_id", "owner-b"]);
    expect(calls).toContainEqual(["eq", "id", "row-1"]);
  });

  it("upserts preferences on the (owner_id, preference_key) conflict target", async () => {
    const calls = [];
    const store = createSupabaseBrainStore(
      fakeSupabase(
        { data: { preference_value: 14 }, error: null },
        calls,
      ),
    );
    const value = await store.setPreference("owner-a", "inferred_decay_days", 14);
    expect(value).toBe(14);
    const upsert = calls.find(([name]) => name === "upsert");
    expect(upsert[1]).toEqual({
      owner_id: "owner-a",
      preference_key: "inferred_decay_days",
      preference_value: 14,
    });
    expect(upsert[2]).toEqual({ onConflict: "owner_id,preference_key" });
  });

  it("maps episode rows to camelCase, including candidate facts", async () => {
    const calls = [];
    const store = createSupabaseBrainStore(
      fakeSupabase(
        {
          data: {
            id: "ep-1",
            owner_id: "owner-a",
            session_id: "s-1",
            content: "turn",
            content_gist: null,
            archive_storage_path: null,
            status: "active",
            tags: ["chat"],
            candidate_facts: [{ key: "k", text: "t" }],
            record_type: null,
            record_id: null,
            created_at: "2026-11-01T10:00:00Z",
            updated_at: "2026-11-01T10:00:00Z",
          },
          error: null,
        },
        calls,
      ),
    );
    const episode = await store.appendEpisode("owner-a", { content: "turn", sessionId: "s-1" });
    expect(episode.sessionId).toBe("s-1");
    expect(episode.candidateFacts).toEqual([{ key: "k", text: "t" }]);
  });
});
