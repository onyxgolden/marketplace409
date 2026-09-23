/**
 * Tests for the crash-resilience autosave draft storage (designerDraft.js).
 *
 * The draft is the recovery source after a page crash: it must round-trip
 * faithfully, reject incompatible/corrupt payloads gracefully, and fall
 * back to stripping underlay images when the browser quota is exhausted.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DRAFT_SCHEMA_VERSION,
  deleteDraft,
  draftKey,
  isNewerDraft,
  readDraft,
  readSavedRecord,
  stripUnderlayDataUrls,
  writeDraft,
  writeSavedRecord,
} from "./designerDraft.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _data: data,
  };
}

function envelopeWithUnderlay() {
  return {
    name: "Test project",
    levels: [
      {
        id: "lvl1",
        design: {
          underlay: { id: "u1", dataUrl: "data:image/png;base64,AAAA" },
        },
      },
      { id: "lvl2", design: {} },
    ],
    currentLevelId: "lvl1",
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe("designerDraft", () => {
  it("round-trips a draft and reads it back", () => {
    globalThis.localStorage = memoryStorage();
    const envelope = envelopeWithUnderlay();
    const result = writeDraft("proj1", { designRevision: 7, envelope });
    expect(result.ok).toBe(true);
    expect(result.underlayOmitted).toBe(false);
    const draft = readDraft("proj1");
    expect(draft.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(draft.designRevision).toBe(7);
    expect(draft.envelope).toEqual(envelope);
    expect(Number.isFinite(draft.savedAt)).toBe(true);
  });

  it("rejects incompatible schema versions and corrupt payloads gracefully", () => {
    globalThis.localStorage = memoryStorage();
    const store = globalThis.localStorage;
    store.setItem(draftKey("proj2"), JSON.stringify({ schemaVersion: 999, designRevision: 3, envelope: { levels: [] } }));
    expect(readDraft("proj2")).toBeNull();
    store.setItem(draftKey("proj3"), "not-json{{{");
    expect(readDraft("proj3")).toBeNull();
    store.setItem(
      draftKey("proj4"),
      JSON.stringify({ schemaVersion: DRAFT_SCHEMA_VERSION, designRevision: 3, envelope: { noLevels: true } }),
    );
    expect(readDraft("proj4")).toBeNull();
    store.setItem(
      draftKey("proj5"),
      JSON.stringify({ schemaVersion: DRAFT_SCHEMA_VERSION, designRevision: NaN, envelope: { levels: [] } }),
    );
    // JSON.stringify(NaN) -> null, which is not finite -> rejected.
    expect(readDraft("proj5")).toBeNull();
  });

  it("returns null when storage is unavailable instead of throwing", () => {
    expect(readDraft("proj6")).toBeNull();
    const result = writeDraft("proj6", { designRevision: 1, envelope: { levels: [] } });
    expect(result.ok).toBe(false);
  });

  it("on quota exhaustion, strips underlay images and retries once", () => {
    const backing = memoryStorage();
    let calls = 0;
    const quotaError = new Error("quota");
    quotaError.name = "QuotaExceededError";
    globalThis.localStorage = {
      ...backing,
      setItem: (k, v) => {
        calls += 1;
        // First attempt (full envelope with the underlay) blows the quota;
        // the slim retry fits.
        if (calls === 1 && v.includes("data:image/png")) throw quotaError;
        backing.setItem(k, v);
      },
    };
    const result = writeDraft("proj7", { designRevision: 4, envelope: envelopeWithUnderlay() });
    expect(result.ok).toBe(true);
    expect(result.underlayOmitted).toBe(true);
    const draft = readDraft("proj7");
    expect(draft.underlayOmitted).toBe(true);
    expect(draft.envelope.levels[0].design.underlay.dataUrl).toBeNull();
    // The second level (no underlay) is untouched.
    expect(draft.envelope.levels[1]).toEqual({ id: "lvl2", design: {} });
  });

  it("stripUnderlayDataUrls leaves envelopes without underlays untouched", () => {
    const envelope = { levels: [{ id: "a", design: {} }] };
    const { envelope: slim, underlayOmitted } = stripUnderlayDataUrls(envelope);
    expect(underlayOmitted).toBe(false);
    expect(slim).toEqual(envelope);
  });

  it("tracks the last server-saved revision and deletes drafts", () => {
    globalThis.localStorage = memoryStorage();
    expect(readSavedRecord("proj8")).toBeNull();
    writeSavedRecord("proj8", 12);
    expect(readSavedRecord("proj8").designRevision).toBe(12);
    writeDraft("proj8", { designRevision: 13, envelope: { levels: [] } });
    expect(readDraft("proj8").designRevision).toBe(13);
    deleteDraft("proj8");
    expect(readDraft("proj8")).toBeNull();
    // The saved-record survives draft deletion.
    expect(readSavedRecord("proj8").designRevision).toBe(12);
  });

  it("isNewerDraft compares revisions, not timestamps", () => {
    expect(isNewerDraft({ designRevision: 8 }, 5)).toBe(true);
    expect(isNewerDraft({ designRevision: 5 }, 5)).toBe(false);
    expect(isNewerDraft({ designRevision: 3 }, 5)).toBe(false);
    expect(isNewerDraft(null, 5)).toBe(false);
  });
});
