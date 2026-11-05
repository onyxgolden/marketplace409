// FORGE Doc-to-Overview — slice A: source-set manifest tests.
// Deterministic: fixed `now`/`uuid` options, no I/O, no randomness.

import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeDocumentHash,
  computeSourceSetHash,
  createSourceSetManifest,
  recordHumanClassification,
  sha256Hex,
  validateDocumentEntry,
} from "./sourceSets.js";

const NOW = "2026-11-04T12:00:00.000Z";

function entry(overrides = {}) {
  return {
    documentId: "doc-1",
    title: "Photosynthesis basics",
    sourceType: "forge-reference",
    contentHash: "a".repeat(64),
    ranges: [{ type: "section", name: "Intro" }],
    permission: { granted: true, basis: "CC BY 4.0" },
    pageCount: null,
    ...overrides,
  };
}

function manifestInput(overrides = {}) {
  return {
    name: "Biology primers",
    ownerId: "owner-1",
    workspaceId: "ws-1",
    curator: { id: "curator-1", displayName: "Casey" },
    purpose: "Explainer sources",
    documents: [entry()],
    ...overrides,
  };
}

describe("createSourceSetManifest", () => {
  it("creates a versioned manifest with stable hashes", () => {
    const first = createSourceSetManifest(manifestInput(), { now: NOW, uuid: "uuid-1" });
    const second = createSourceSetManifest(manifestInput(), { now: NOW, uuid: "uuid-1" });
    expect(first.ok).toBe(true);
    expect(first.manifest.id).toBe("manifest_uuid-1");
    expect(first.manifest.version).toBe(1);
    expect(first.manifest.createdAt).toBe(NOW);
    expect(first.manifest.sourceSetHash).toBe(second.manifest.sourceSetHash);
    expect(first.manifest.sourceSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifest.humanClassifications).toEqual([]);
  });

  it("changes the source-set hash when a source changes, not when a permission note changes", () => {
    const base = createSourceSetManifest(manifestInput(), { now: NOW, uuid: "u" }).manifest;
    const changedSource = createSourceSetManifest(
      manifestInput({ documents: [entry({ contentHash: "b".repeat(64) })] }),
      { now: NOW, uuid: "u" },
    ).manifest;
    const changedNote = createSourceSetManifest(
      manifestInput({ documents: [entry({ permission: { granted: true, basis: "Public domain" } })] }),
      { now: NOW, uuid: "u" },
    ).manifest;
    expect(changedSource.sourceSetHash).not.toBe(base.sourceSetHash);
    expect(changedNote.sourceSetHash).toBe(base.sourceSetHash);
  });

  it("rejects bad names, owners, curators, duplicates and too many documents", () => {
    expect(createSourceSetManifest(manifestInput({ name: "" })).ok).toBe(false);
    expect(createSourceSetManifest(manifestInput({ ownerId: "../evil" })).ok).toBe(false);
    expect(createSourceSetManifest(manifestInput({ curator: {} })).ok).toBe(false);
    expect(createSourceSetManifest(manifestInput({ documents: [entry(), entry()] })).errors
      .some((e) => e.code === "DUPLICATE_DOCUMENT")).toBe(true);
    const many = Array.from({ length: 11 }, (_, i) => entry({ documentId: `doc-${i}` }));
    expect(createSourceSetManifest(manifestInput({ documents: many })).errors
      .some((e) => e.code === "TOO_MANY_DOCUMENTS")).toBe(true);
  });

  it("rejects overlapping and out-of-range page ranges", () => {
    const overlapping = validateDocumentEntry(
      entry({ ranges: [{ type: "page", start: 1, end: 3 }, { type: "page", start: 3, end: 5 }] }),
      10,
    );
    expect(overlapping.errors.some((e) => e.code === "OVERLAPPING_RANGES")).toBe(true);
    const outOfRange = validateDocumentEntry(entry({ ranges: [{ type: "page", start: 9, end: 12 }] }), 10);
    expect(outOfRange.errors.some((e) => e.code === "OUT_OF_RANGE")).toBe(true);
    const noPageCount = validateDocumentEntry(entry({ ranges: [{ type: "page", start: 1, end: 2 }] }), null);
    expect(noPageCount.ok).toBe(false);
  });

  it("requires explicit permission with a basis, and a valid content hash", () => {
    expect(validateDocumentEntry(entry({ permission: { granted: false, basis: "x" } }), null).ok).toBe(false);
    expect(validateDocumentEntry(entry({ permission: { granted: true, basis: "" } }), null).ok).toBe(false);
    expect(validateDocumentEntry(entry({ contentHash: "not-a-hash" }), null).ok).toBe(false);
  });

  it("binds page content to the manifest: page ranges require page hashes", () => {
    const pageHashes = [sha256Hex("page one"), sha256Hex("page two")];
    const bound = validateDocumentEntry(
      entry({ ranges: [{ type: "page", start: 1, end: 2 }], pageHashes }),
      2,
    );
    expect(bound.ok).toBe(true);
    const unbound = validateDocumentEntry(
      entry({ ranges: [{ type: "page", start: 1, end: 2 }] }),
      2,
    );
    expect(unbound.errors.some((e) => e.code === "INVALID_PAGE_HASHES")).toBe(true);
    const wrongLength = validateDocumentEntry(
      entry({ ranges: [{ type: "page", start: 1, end: 2 }], pageHashes: [sha256Hex("page one")] }),
      2,
    );
    expect(wrongLength.errors.some((e) => e.code === "INVALID_PAGE_HASHES")).toBe(true);
    const nonHex = validateDocumentEntry(
      entry({ ranges: [{ type: "page", start: 1, end: 2 }], pageHashes: ["not-a-hash", "also-not"] }),
      2,
    );
    expect(nonHex.errors.some((e) => e.code === "INVALID_PAGE_HASHES")).toBe(true);
  });

  it("records page hashes on the manifest and covers them in the source-set hash", () => {
    const pageHashes = [sha256Hex("page one"), sha256Hex("page two")];
    const base = createSourceSetManifest(
      manifestInput({ documents: [entry({ ranges: [{ type: "page", start: 1, end: 2 }], pageHashes, pageCount: 2 })] }),
      { now: NOW, uuid: "u" },
    );
    expect(base.ok).toBe(true);
    expect(base.manifest.documents[0].pageHashes).toEqual(pageHashes);
    const changedPages = createSourceSetManifest(
      manifestInput({ documents: [entry({ ranges: [{ type: "page", start: 1, end: 2 }], pageHashes: [sha256Hex("page ONE"), sha256Hex("page two")], pageCount: 2 })] }),
      { now: NOW, uuid: "u" },
    );
    expect(changedPages.manifest.sourceSetHash).not.toBe(base.manifest.sourceSetHash);
  });
});

describe("sha256 / canonical JSON", () => {
  it("hashes deterministically regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(computeDocumentHash("abc")).toBe(sha256Hex("abc"));
    expect(computeSourceSetHash([])).toBe(sha256Hex("[]"));
  });
});

describe("recordHumanClassification", () => {
  it("records an attributed decision, bumps version, and leaves the source-set hash alone", () => {
    const base = createSourceSetManifest(manifestInput(), { now: NOW, uuid: "u" }).manifest;
    const recorded = recordHumanClassification(
      base,
      { documentId: "doc-1", decision: "admit", classifier: "curator-1", reason: "Reference chapter, not a procedure." },
      { now: "2026-11-04T13:00:00.000Z" },
    );
    expect(recorded.ok).toBe(true);
    expect(recorded.manifest.version).toBe(2);
    expect(recorded.manifest.sourceSetHash).toBe(base.sourceSetHash);
    expect(recorded.manifest.humanClassifications).toHaveLength(1);
    expect(recorded.manifest.humanClassifications[0].classifier).toBe("curator-1");
  });

  it("requires decision, document, classifier and reason", () => {
    const base = createSourceSetManifest(manifestInput(), { now: NOW, uuid: "u" }).manifest;
    expect(recordHumanClassification(base, { documentId: "doc-1", decision: "maybe", classifier: "c", reason: "r" }).ok).toBe(false);
    expect(recordHumanClassification(base, { documentId: "doc-1", decision: "admit", classifier: "", reason: "r" }).ok).toBe(false);
    expect(recordHumanClassification(base, { documentId: "doc-1", decision: "admit", classifier: "c", reason: "" }).ok).toBe(false);
  });
});
