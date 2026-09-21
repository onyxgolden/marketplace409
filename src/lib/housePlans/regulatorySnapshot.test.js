// @vitest-environment node

import {
  MAX_SNAPSHOT_LABEL_LENGTH,
  createRegulatorySnapshot,
  snapshotContentHash,
  validateRegulatorySnapshot,
} from "./regulatorySnapshot";

// Neutral fictitious fixtures only: HP-L4 inherits the HP-L1 "zero ICC
// involvement" boundary, so no real code/authority names appear here.
const sourceA = () => ({
  title: "Fictitious Building Code, Section 101 (TEST FIXTURE)",
  issuingAuthority: "Fictitious Building Authority (TEST FIXTURE)",
  officialUrl: "https://example.invalid/official-sources/fbc-101",
});

const sourceB = () => ({
  title: "Sample Drainage Reference",
  sectionIdentifier: "SEC-204.1",
  issuingAuthority: "Sample Water Authority",
  jurisdiction: "Texas",
  edition: "2024",
  effectiveDate: "2024-01-01",
  officialUrl: "https://example.invalid/official-sources/drain-204",
  topicTags: ["drainage"],
  provenance: "curated",
  retrievalDate: "2026-09-21",
  verificationDate: "2026-09-21",
  jurisdictionState: "VERIFIED_SOURCE",
});

describe("regulatorySnapshot (HP-L4)", () => {
  describe("createRegulatorySnapshot", () => {
    it("creates a snapshot from valid sources", () => {
      const result = createRegulatorySnapshot({ sources: [sourceA(), sourceB()] });
      expect(result.ok).toBe(true);
      expect(result.errors).toBeUndefined();
      const { snapshot } = result;
      expect(snapshot.label).toBeNull();
      expect(snapshot.sourceCount).toBe(2);
      expect(snapshot.entries).toHaveLength(2);
      expect(typeof snapshot.contentHash).toBe("string");
      expect(snapshot.contentHash.length).toBeGreaterThan(0);
      expect(Number.isNaN(new Date(snapshot.capturedAt).getTime())).toBe(false);
    });

    it("orders entries deterministically by official URL", () => {
      const result = createRegulatorySnapshot({ sources: [sourceA(), sourceB()] });
      expect(result.ok).toBe(true);
      // "drain-204" sorts before "fbc-101".
      expect(result.snapshot.entries[0].officialUrl).toBe(
        "https://example.invalid/official-sources/drain-204"
      );
      expect(result.snapshot.entries[1].officialUrl).toBe(
        "https://example.invalid/official-sources/fbc-101"
      );
    });

    it("produces the same content hash regardless of source order", () => {
      const first = createRegulatorySnapshot({ sources: [sourceA(), sourceB()] });
      const second = createRegulatorySnapshot({ sources: [sourceB(), sourceA()] });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.snapshot.contentHash).toBe(second.snapshot.contentHash);
    });

    it("produces a different content hash when the library changes", () => {
      const before = createRegulatorySnapshot({ sources: [sourceA()] });
      const after = createRegulatorySnapshot({ sources: [sourceA(), sourceB()] });
      expect(before.snapshot.contentHash).not.toBe(after.snapshot.contentHash);
    });

    it("rejects an empty or missing sources array", () => {
      for (const input of [{}, { sources: [] }, { sources: "nope" }, null]) {
        const result = createRegulatorySnapshot(input);
        expect(result.ok).toBe(false);
        expect(result.errors.join(" ")).toContain('"sources" must be a non-empty array');
      }
    });

    it("rejects invalid sources with an indexed error", () => {
      const bad = { ...sourceA(), officialUrl: "http://not-https.example/" };
      const result = createRegulatorySnapshot({ sources: [sourceA(), bad] });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.startsWith("sources[1]:"))).toBe(true);
    });

    it("rejects forbidden content fields on sources", () => {
      const withSummary = { ...sourceA(), summary: "Stairs must be safe." };
      const result = createRegulatorySnapshot({ sources: [withSummary] });
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toContain('"summary" is not allowed');
    });

    it("trims an optional label", () => {
      const result = createRegulatorySnapshot({
        sources: [sourceA()],
        label: "  Pre-permit review  ",
      });
      expect(result.ok).toBe(true);
      expect(result.snapshot.label).toBe("Pre-permit review");
    });

    it("rejects an empty or overlong label", () => {
      const empty = createRegulatorySnapshot({ sources: [sourceA()], label: "   " });
      expect(empty.ok).toBe(false);
      const long = createRegulatorySnapshot({
        sources: [sourceA()],
        label: "x".repeat(MAX_SNAPSHOT_LABEL_LENGTH + 1),
      });
      expect(long.ok).toBe(false);
    });

    it("accepts an explicit capturedAt and defaults to now", () => {
      const explicit = createRegulatorySnapshot({
        sources: [sourceA()],
        capturedAt: "2026-09-01T12:00:00.000Z",
      });
      expect(explicit.ok).toBe(true);
      expect(explicit.snapshot.capturedAt).toBe("2026-09-01T12:00:00.000Z");

      const bad = createRegulatorySnapshot({ sources: [sourceA()], capturedAt: "not-a-date" });
      expect(bad.ok).toBe(false);
    });

    it("returns a deeply frozen, immutable snapshot", () => {
      const result = createRegulatorySnapshot({ sources: [sourceA()] });
      expect(result.ok).toBe(true);
      const { snapshot } = result;
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.entries)).toBe(true);
      expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    });

    it("does not mutate the caller's input", () => {
      const sources = [sourceB(), sourceA()];
      const before = JSON.stringify(sources);
      const result = createRegulatorySnapshot({ sources });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(sources)).toBe(before);
    });
  });

  describe("snapshotContentHash", () => {
    it("is deterministic and order-independent", () => {
      const a = [{ officialUrl: "https://example.invalid/2", title: "B" }];
      const b = [{ title: "B", officialUrl: "https://example.invalid/2" }];
      expect(snapshotContentHash(a)).toBe(snapshotContentHash(b));
    });
  });

  describe("validateRegulatorySnapshot", () => {
    it("accepts a snapshot produced by createRegulatorySnapshot", () => {
      const built = createRegulatorySnapshot({ sources: [sourceA(), sourceB()], label: "v1" });
      expect(built.ok).toBe(true);
      const checked = validateRegulatorySnapshot(built.snapshot);
      expect(checked).toEqual({ ok: true, errors: [] });
    });

    it("rejects a tampered content hash", () => {
      const built = createRegulatorySnapshot({ sources: [sourceA()] });
      const tampered = { ...built.snapshot, contentHash: "deadbeef" };
      const checked = validateRegulatorySnapshot(tampered);
      expect(checked.ok).toBe(false);
      expect(checked.errors.join(" ")).toContain('"contentHash" does not match');
    });

    it("rejects empty entries, bad dates, and count mismatches", () => {
      const built = createRegulatorySnapshot({ sources: [sourceA()] });
      const base = built.snapshot;
      expect(validateRegulatorySnapshot({ ...base, entries: [] }).ok).toBe(false);
      expect(validateRegulatorySnapshot({ ...base, capturedAt: "junk" }).ok).toBe(false);
      expect(validateRegulatorySnapshot({ ...base, sourceCount: 99 }).ok).toBe(false);
      expect(validateRegulatorySnapshot(null).ok).toBe(false);
    });
  });
});
