// FORGE Doc-to-Overview — slice B: generation + review orchestration tests.
// Real filesystem store in a temp directory (slice A pattern); manifests
// are built through slice A's picker so hashes and ranges are real.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDraftStore } from "./draftStore.js";
import { pickSources } from "./picker.js";
import { computeSourceSetHash } from "@/domains/doc-overview/sourceSets.js";
import {
  exportArtifact,
  generateDrafts,
  getArtifactPreview,
  listArtifacts,
  reviewArtifact,
} from "./generate.js";

const DOC_A_TEXT = [
  "# Photosynthesis",
  "",
  "## Overview",
  "",
  "Photosynthesis is the process by which green plants convert sunlight, water, and carbon dioxide into oxygen and glucose. This process takes place primarily in the leaves of plants, inside organelles called chloroplasts.",
  "",
  "## Process",
  "",
  "The light-dependent reactions occur in the thylakoid membranes of the chloroplast. The Calvin cycle then fixes carbon dioxide into sugar molecules using energy captured from sunlight.",
  "",
].join("\n");

const DOC_B_TEXT = [
  "# Cellular Respiration",
  "",
  "## Overview",
  "",
  "Cellular respiration is the process by which cells break down glucose to release energy in the form of ATP. This process occurs in the mitochondria of eukaryotic cells.",
  "",
  "## Stages",
  "",
  "Glycolysis takes place in the cytoplasm and splits one glucose molecule into two pyruvate molecules. The electron transport chain generates most of the ATP.",
  "",
].join("\n");

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "doc-overview-generate-"));
}

function setup() {
  const root = tempRoot();
  const store = createDraftStore(root, { ownerId: "owner-1" });
  const picked = pickSources({
    name: "Energy in living cells",
    ownerId: "owner-1",
    curator: { id: "curator-1", displayName: "Curator" },
    purpose: "Test fixture",
    documents: [
      {
        documentId: "doc_a", title: "Photosynthesis", sourceType: "forge-reference",
        text: DOC_A_TEXT, ranges: [{ type: "section", name: "Overview" }, { type: "section", name: "Process" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
      {
        documentId: "doc_b", title: "Cellular Respiration", sourceType: "forge-reference",
        text: DOC_B_TEXT, ranges: [{ type: "section", name: "Overview" }, { type: "section", name: "Stages" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
    ],
  });
  if (!picked.ok) throw new Error(`fixture pick failed: ${JSON.stringify(picked.rejections)}`);
  store.saveSourceSet(picked.manifest);
  const texts = { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } };
  return { root, store, manifest: picked.manifest, texts };
}

function generate(store, manifest, texts) {
  const result = generateDrafts({ store, manifestId: manifest.id, documents: texts, curator: "curator-1" });
  if (!result.ok) throw new Error(`fixture generate failed: ${JSON.stringify(result.error)}`);
  return result.artifacts;
}

describe("generateDrafts", () => {
  it("creates explainer + infographic drafts, stored and reloadable", () => {
    const { root, store, manifest, texts } = setup();
    const artifacts = generate(store, manifest, texts);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.type).sort()).toEqual(["explainer", "infographic"]);
    for (const summary of artifacts) {
      expect(summary.status).toBe("draft");
      expect(summary.version).toBe(1);
      const stored = store.getDraft(summary.id);
      expect(stored.content).toBeDefined();
      expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.ownerId).toBe("owner-1");
      expect(stored.content.method).toBe("extractive-local-v1");
    }
    // Reload preserves the drafts across store instances.
    const second = createDraftStore(root, { ownerId: "owner-1" });
    expect(second.listDrafts()).toHaveLength(2);
    const reloaded = second.getDraft(artifacts[0].id);
    expect(reloaded.content.title).toBe("Energy in living cells");
  });

  it("refuses to generate when a source changed (STALE_SOURCE)", () => {
    const { store, manifest, texts } = setup();
    const changed = { ...texts, doc_a: { text: `${DOC_A_TEXT}\nAn added sentence changes the hash.` } };
    const result = generateDrafts({ store, manifestId: manifest.id, documents: changed, curator: "curator-1" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("STALE_SOURCE");
    expect(store.listDrafts()).toEqual([]);
  });

  it("refuses unknown manifests and missing sources", () => {
    const { store, texts } = setup();
    expect(generateDrafts({ store, manifestId: "manifest_nope", documents: texts, curator: "curator-1" }).error.code).toBe("NOT_FOUND");
    const { store: store2, manifest } = setup();
    const missing = generateDrafts({ store: store2, manifestId: manifest.id, documents: { doc_a: { text: DOC_A_TEXT } }, curator: "curator-1" });
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("MISSING_SOURCE");
  });

  it("refuses oversized supplied texts before extracting", () => {
    const { store, manifest } = setup();
    const big = { doc_a: { text: "x".repeat(2_000_001) }, doc_b: { text: DOC_B_TEXT } };
    const result = generateDrafts({ store, manifestId: manifest.id, documents: big, curator: "curator-1" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("TOTAL_OVERSIZED");
  });

  it("is owner-scoped: another owner cannot generate on the manifest", () => {
    const { root, manifest, texts } = setup();
    const other = createDraftStore(root, { ownerId: "owner-2" });
    const result = generateDrafts({ store: other, manifestId: manifest.id, documents: texts, curator: "curator-2" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("review flow", () => {
  it("runs draft → submit → approve → keep → export, with reload intact", () => {
    const { root, store, manifest, texts } = setup();
    const [explainer, infographic] = generate(store, manifest, texts);
    const actor = "curator-1";

    // Approve straight from draft is illegal; discard from kept is fine.
    expect(reviewArtifact({ store, artifactId: explainer.id, action: "approve", actor }).ok).toBe(false);
    expect(reviewArtifact({ store, artifactId: explainer.id, action: "approve", actor }).error.code).toBe("ILLEGAL_TRANSITION");

    const submitted = reviewArtifact({ store, artifactId: explainer.id, action: "submit", actor });
    expect(submitted.ok).toBe(true);
    expect(submitted.artifact.status).toBe("needs_review");

    const approved = reviewArtifact({ store, artifactId: explainer.id, action: "approve", actor });
    expect(approved.ok).toBe(true);
    expect(approved.artifact.status).toBe("approved");
    expect(approved.artifact.reviewHistory.map((r) => r.action)).toEqual(["submit", "approve"]);

    const kept = reviewArtifact({ store, artifactId: explainer.id, action: "keep", actor });
    expect(kept.ok).toBe(true);
    expect(kept.artifact.status).toBe("kept");

    const exported = exportArtifact({ store, artifactId: explainer.id });
    expect(exported.ok).toBe(true);
    expect(exported.filename).toBe(`${explainer.id}.md`);
    expect(exported.mimeType).toContain("text/markdown");
    expect(exported.content).toContain("# Energy in living cells");
    expect(exported.content).toContain("## References");

    const exportedSvg = exportArtifact({ store, artifactId: infographic.id });
    expect(exportedSvg.ok).toBe(false);
    expect(exportedSvg.error.code).toBe("NOT_EXPORTABLE");

    // Reload preserves the kept artifact and its approval record.
    const second = createDraftStore(root, { ownerId: "owner-1" });
    const reloaded = second.getDraft(explainer.id);
    expect(reloaded.status).toBe("kept");
    expect(reloaded.reviewHistory).toHaveLength(3);

    const discarded = reviewArtifact({ store, artifactId: explainer.id, action: "discard", actor });
    expect(discarded.ok).toBe(true);
    expect(discarded.artifact.status).toBe("discarded");
    expect(exportArtifact({ store, artifactId: explainer.id }).error.code).toBe("NOT_EXPORTABLE");
  });

  it("exports the infographic SVG once approved", () => {
    const { store, manifest, texts } = setup();
    const [, infographic] = generate(store, manifest, texts);
    const actor = "curator-1";
    reviewArtifact({ store, artifactId: infographic.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: infographic.id, action: "approve", actor });
    const exported = exportArtifact({ store, artifactId: infographic.id });
    expect(exported.ok).toBe(true);
    expect(exported.filename).toBe(`${infographic.id}.svg`);
    expect(exported.mimeType).toContain("image/svg+xml");
    expect(exported.content).toContain("<svg");
    expect(exported.content).not.toContain("<script");
  });

  it("invalidates approval when a source changes, and refuses approve/keep/export", () => {
    const { store, manifest, texts } = setup();
    const [explainer] = generate(store, manifest, texts);
    const actor = "curator-1";
    reviewArtifact({ store, artifactId: explainer.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: explainer.id, action: "approve", actor });

    // Simulate the source changing after approval: same manifest id,
    // new content hash + recomputed source-set hash.
    const changed = {
      ...manifest,
      documents: manifest.documents.map((d, i) => (i === 0 ? { ...d, contentHash: "b".repeat(64) } : d)),
    };
    changed.sourceSetHash = computeSourceSetHash(changed.documents);
    store.saveSourceSet(changed);

    const keep = reviewArtifact({ store, artifactId: explainer.id, action: "keep", actor });
    expect(keep.ok).toBe(false);
    expect(keep.error.code).toBe("STALE_SOURCE");
    const stored = store.getDraft(explainer.id);
    expect(stored.status).toBe("needs_review");
    expect(stored.stale).toBe(true);
    expect(exportArtifact({ store, artifactId: explainer.id }).error.code).toBe("STALE_SOURCE");
  });

  it("edits a draft with a cited sentence, and refuses reworded words on a citation", () => {
    const { store, manifest, texts } = setup();
    const [explainer] = generate(store, manifest, texts);
    const actor = "curator-1";
    const draft = store.getDraft(explainer.id);
    const citation = draft.content.summary[0].citations[0];

    const edited = reviewArtifact({
      store,
      artifactId: explainer.id,
      action: "edit",
      actor,
      editedContent: {
        kind: "explainer",
        title: "Energy in living cells (curator title)",
        summary: [{ text: draft.content.summary[0].text, citations: [citation] }],
        keyConcepts: draft.content.keyConcepts,
        context: [],
        glossary: [],
      },
    });
    expect(edited.ok).toBe(true);
    expect(edited.artifact.version).toBe(2);
    const stored = store.getDraft(explainer.id);
    expect(stored.content.title).toBe("Energy in living cells (curator title)");
    expect(stored.contentHash).not.toBe(draft.contentHash);

    const reworded = reviewArtifact({
      store,
      artifactId: explainer.id,
      action: "edit",
      actor,
      editedContent: {
        kind: "explainer",
        summary: [{ text: "Curator rewording, presented as if sourced.", citations: [citation] }],
      },
    });
    expect(reworded.ok).toBe(false);
    expect(reworded.error.code).toBe("CITATION_AUDIT_FAILED");
    // The refused edit stored nothing.
    expect(store.getDraft(explainer.id).version).toBe(2);
  });

  it("sends a needs_review edit back to draft", () => {
    const { store, manifest, texts } = setup();
    const [explainer] = generate(store, manifest, texts);
    const actor = "curator-1";
    reviewArtifact({ store, artifactId: explainer.id, action: "submit", actor });
    const draft = store.getDraft(explainer.id);
    const edited = reviewArtifact({
      store,
      artifactId: explainer.id,
      action: "edit",
      actor,
      editedContent: { kind: "explainer", summary: draft.content.summary },
    });
    expect(edited.ok).toBe(true);
    expect(edited.artifact.status).toBe("draft");
    expect(edited.artifact.reviewHistory.map((r) => r.action)).toContain("revise");
    expect(edited.artifact.reviewHistory.map((r) => r.action)).toContain("edit");
  });

  it("requires an actor for every review action", () => {
    const { store, manifest, texts } = setup();
    const [explainer] = generate(store, manifest, texts);
    const result = reviewArtifact({ store, artifactId: explainer.id, action: "submit", actor: "  " });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ACTOR");
  });
});

describe("preview and listing", () => {
  it("previews a draft watermarked, and un-watermarked once approved", () => {
    const { store, manifest, texts } = setup();
    const [explainer] = generate(store, manifest, texts);
    const actor = "curator-1";
    const draftPreview = getArtifactPreview({ store, artifactId: explainer.id });
    expect(draftPreview.ok).toBe(true);
    expect(draftPreview.stale).toBe(false);
    expect(draftPreview.html).toContain("DRAFT — NOT VERIFIED");
    reviewArtifact({ store, artifactId: explainer.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: explainer.id, action: "approve", actor });
    const approvedPreview = getArtifactPreview({ store, artifactId: explainer.id });
    expect(approvedPreview.html).not.toContain("DRAFT — NOT VERIFIED");
  });

  it("lists summaries without content, and hides other owners' drafts", () => {
    const { root, store, manifest, texts } = setup();
    generate(store, manifest, texts);
    const listed = listArtifacts({ store });
    expect(listed.ok).toBe(true);
    expect(listed.artifacts).toHaveLength(2);
    expect(listed.artifacts[0].content).toBeUndefined();
    const other = createDraftStore(root, { ownerId: "owner-2" });
    expect(listArtifacts({ store: other }).artifacts).toEqual([]);
    expect(getArtifactPreview({ store: other, artifactId: listed.artifacts[0].id }).error.code).toBe("NOT_FOUND");
  });
});
