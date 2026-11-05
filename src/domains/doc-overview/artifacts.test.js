// FORGE Doc-to-Overview — slice A: artifact contract tests.

import { describe, expect, it } from "vitest";
import {
  checkFreshness,
  computeArtifactHash,
  createDraftArtifact,
  invalidateIfStale,
  transitionArtifact,
} from "./artifacts.js";

const NOW = "2026-11-04T12:00:00.000Z";

function sourceSet(overrides = {}) {
  return {
    id: "manifest_1",
    sourceSetHash: "c".repeat(64),
    documents: [
      { documentId: "doc-1", contentHash: "a".repeat(64), ranges: [{ type: "section", name: "Intro" }] },
      { documentId: "doc-2", contentHash: "b".repeat(64), ranges: [{ type: "section", name: "Intro" }] },
    ],
    ...overrides,
  };
}

function draft(overrides = {}) {
  const created = createDraftArtifact(
    { sourceSet: sourceSet(), type: "explainer", createdBy: "curator-1" },
    { now: NOW, uuid: "uuid-1" },
  );
  expect(created.ok).toBe(true);
  return { ...created.artifact, ...overrides };
}

describe("createDraftArtifact", () => {
  it("creates a draft shell with provenance and no generated content", () => {
    const artifact = draft();
    expect(artifact.status).toBe("draft");
    expect(artifact.version).toBe(1);
    expect(artifact.stale).toBe(false);
    expect(artifact.provenance.manifestHash).toBe("c".repeat(64));
    expect(artifact.provenance.sources).toHaveLength(2);
    expect(artifact).not.toHaveProperty("content");
    expect(artifact.reviewHistory).toEqual([]);
  });

  it("rejects bad types and missing curators", () => {
    expect(createDraftArtifact({ sourceSet: sourceSet(), type: "video", createdBy: "c" }).ok).toBe(false);
    expect(createDraftArtifact({ sourceSet: sourceSet(), type: "explainer", createdBy: " " }).ok).toBe(false);
    expect(createDraftArtifact({ sourceSet: null, type: "explainer", createdBy: "c" }).ok).toBe(false);
  });
});

describe("transitionArtifact", () => {
  it("walks the full lifecycle with version bumps and review records", () => {
    let a = draft();
    a = transitionArtifact(a, { action: "submit", actor: "curator-1" }, { now: NOW }).artifact;
    expect(a.status).toBe("needs_review");
    expect(a.version).toBe(2);
    a = transitionArtifact(a, { action: "approve", actor: "reviewer-1", reason: "Citations checked" }, { now: NOW }).artifact;
    expect(a.status).toBe("approved");
    expect(a.reviewHistory).toHaveLength(2);
    expect(a.reviewHistory[1].reason).toBe("Citations checked");
    a = transitionArtifact(a, { action: "keep", actor: "curator-1" }, { now: NOW }).artifact;
    expect(a.status).toBe("kept");
    expect(a.version).toBe(4);
    a = transitionArtifact(a, { action: "discard", actor: "curator-1" }, { now: NOW }).artifact;
    expect(a.status).toBe("discarded");
  });

  it("supports revise back to draft from needs_review", () => {
    let a = draft();
    a = transitionArtifact(a, { action: "submit", actor: "c" }, { now: NOW }).artifact;
    a = transitionArtifact(a, { action: "revise", actor: "c", reason: "Fix citations" }, { now: NOW }).artifact;
    expect(a.status).toBe("draft");
  });

  it("rejects illegal transitions and missing actors — never a silent no-op", () => {
    const a = draft();
    expect(transitionArtifact(a, { action: "approve", actor: "c" }).ok).toBe(false);
    expect(transitionArtifact(a, { action: "keep", actor: "c" }).ok).toBe(false);
    expect(transitionArtifact(a, { action: "submit", actor: " " }).ok).toBe(false);
    const discarded = transitionArtifact(
      transitionArtifact(a, { action: "discard", actor: "c" }, { now: NOW }).artifact,
      { action: "submit", actor: "c" },
    );
    expect(discarded.ok).toBe(false);
    expect(discarded.errors[0].code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("freshness and invalidation", () => {
  it("is fresh when hashes match", () => {
    expect(checkFreshness(draft(), sourceSet()).fresh).toBe(true);
  });

  it("detects changed, removed and manifest-level changes", () => {
    const a = draft();
    const changed = sourceSet({
      sourceSetHash: "d".repeat(64),
      documents: [
        { documentId: "doc-1", contentHash: "f".repeat(64), ranges: [] },
        { documentId: "doc-2", contentHash: "b".repeat(64), ranges: [] },
      ],
    });
    const result = checkFreshness(a, changed);
    expect(result.fresh).toBe(false);
    expect(result.staleReasons.map((r) => r.code)).toContain("SOURCE_CHANGED");
    const removed = sourceSet({ documents: [{ documentId: "doc-1", contentHash: "a".repeat(64), ranges: [] }] });
    expect(checkFreshness(a, removed).staleReasons.map((r) => r.code)).toContain("SOURCE_REMOVED");
  });

  it("demotes approved/kept artifacts to needs_review on source change, flags drafts in place", () => {
    let approved = draft();
    approved = transitionArtifact(approved, { action: "submit", actor: "c" }, { now: NOW }).artifact;
    approved = transitionArtifact(approved, { action: "approve", actor: "r" }, { now: NOW }).artifact;
    const changed = sourceSet({
      sourceSetHash: "d".repeat(64),
      documents: sourceSet().documents,
    });
    const demoted = invalidateIfStale(approved, changed, { actor: "system" }, { now: NOW });
    expect(demoted.invalidated).toBe(true);
    expect(demoted.artifact.status).toBe("needs_review");
    expect(demoted.artifact.stale).toBe(true);
    expect(demoted.artifact.reviewHistory.at(-1).action).toBe("invalidate");

    const fresh = invalidateIfStale(draft(), sourceSet(), { actor: "system" });
    expect(fresh.invalidated).toBe(false);
    expect(fresh.artifact.status).toBe("draft");
  });

  it("hashes the contract deterministically and changes with version and provenance", () => {
    const a = draft();
    expect(computeArtifactHash(a)).toBe(computeArtifactHash(draft()));
    const moved = transitionArtifact(a, { action: "submit", actor: "c" }, { now: NOW }).artifact;
    expect(computeArtifactHash(moved)).not.toBe(computeArtifactHash(a));
    const changed = { ...a, provenance: { ...a.provenance, manifestHash: "f".repeat(64) } };
    expect(computeArtifactHash(changed)).not.toBe(computeArtifactHash(a));
  });
});
