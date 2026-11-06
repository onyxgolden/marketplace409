// FORGE Doc-to-Overview — slice B: single-artifact, review and export
// route tests. Auth is mocked; the store root is a temp directory via
// DOC_OVERVIEW_ROOT.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: authMock,
}));

import { GET as getArtifact } from "./route.js";
import { POST as review } from "./review/route.js";
import { GET as exportArtifact } from "./export/route.js";
import { POST as generate } from "../route.js";
import { createDraftStore } from "@/application/doc-overview/draftStore.js";
import { pickSources } from "@/application/doc-overview/picker.js";

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
].join("\n");

async function setupGenerated() {
  const root = mkdtempSync(path.join(tmpdir(), "doc-overview-item-"));
  process.env.DOC_OVERVIEW_ROOT = root;
  const store = createDraftStore(root, { ownerId: "owner-1" });
  const picked = pickSources({
    name: "Energy in living cells",
    ownerId: "owner-1",
    curator: { id: "curator-1" },
    purpose: "Item test fixture",
    documents: [
      {
        documentId: "doc_a", title: "Photosynthesis", sourceType: "forge-reference",
        text: DOC_A_TEXT, ranges: [{ type: "section", name: "Overview" }, { type: "section", name: "Process" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
      {
        documentId: "doc_b", title: "Cellular Respiration", sourceType: "forge-reference",
        text: DOC_B_TEXT, ranges: [{ type: "section", name: "Overview" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
    ],
  });
  if (!picked.ok) throw new Error(`fixture pick failed: ${JSON.stringify(picked.rejections)}`);
  store.saveSourceSet(picked.manifest);
  const res = await generate(new Request("http://localhost/api/doc-overview/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manifestId: picked.manifest.id,
      documents: { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } },
    }),
  }));
  if (res.status !== 201) throw new Error(`fixture generate failed: ${res.status}`);
  const body = await res.json();
  const explainer = body.artifacts.find((a) => a.type === "explainer");
  const infographic = body.artifacts.find((a) => a.type === "infographic");
  return { root, store, explainer, infographic };
}

function params(artifactId) {
  return { params: Promise.resolve({ artifactId }) };
}

function postJson(url, payload) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("doc-overview single-artifact routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "curator-1" }, effectiveOwnerId: "owner-1" });
  });

  it("previews a draft watermarked, and 404s for another owner's draft", async () => {
    const { explainer } = await setupGenerated();
    const res = await getArtifact(new Request(`http://localhost/api/doc-overview/artifacts/${explainer.id}`), params(explainer.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.type).toBe("explainer");
    expect(body.stale).toBe(false);
    expect(body.html).toContain("DRAFT — NOT VERIFIED");
    expect(body.html).toContain("Photosynthesis");

    authMock.mockResolvedValue({ user: { id: "curator-2" }, effectiveOwnerId: "owner-2" });
    const foreign = await getArtifact(new Request(`http://localhost/api/doc-overview/artifacts/${explainer.id}`), params(explainer.id));
    expect(foreign.status).toBe(404);
  });

  it("runs the review flow and exports the approved explainer", async () => {
    const { explainer } = await setupGenerated();
    const url = `http://localhost/api/doc-overview/artifacts/${explainer.id}/review`;

    const illegal = await review(postJson(url, { action: "approve" }), params(explainer.id));
    expect(illegal.status).toBe(409);
    expect((await illegal.json()).code).toBe("ILLEGAL_TRANSITION");

    const submitted = await review(postJson(url, { action: "submit" }), params(explainer.id));
    expect(submitted.status).toBe(200);
    expect((await submitted.json()).artifact.status).toBe("needs_review");

    const approved = await review(postJson(url, { action: "approve" }), params(explainer.id));
    expect(approved.status).toBe(200);
    expect((await approved.json()).artifact.status).toBe("approved");

    const exported = await exportArtifact(
      new Request(`http://localhost/api/doc-overview/artifacts/${explainer.id}/export`),
      params(explainer.id),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/markdown");
    expect(exported.headers.get("content-disposition")).toContain(`${explainer.id}.md`);
    const text = await exported.text();
    expect(text).toContain("# Energy in living cells");
    expect(text).toContain("## References");
  });

  it("refuses export of a draft (409 NOT_EXPORTABLE)", async () => {
    const { infographic } = await setupGenerated();
    const res = await exportArtifact(
      new Request(`http://localhost/api/doc-overview/artifacts/${infographic.id}/export`),
      params(infographic.id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NOT_EXPORTABLE");
  });

  it("refuses an edit whose words do not match their citation (422)", async () => {
    const { store, explainer } = await setupGenerated();
    const draft = store.getDraft(explainer.id);
    const citation = draft.content.summary[0].citations[0];
    const url = `http://localhost/api/doc-overview/artifacts/${explainer.id}/review`;
    const res = await review(postJson(url, {
      action: "edit",
      editedContent: {
        kind: "explainer",
        summary: [{ text: "Curator rewording, presented as if sourced.", citations: [citation] }],
      },
    }), params(explainer.id));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("CITATION_AUDIT_FAILED");
  });

  it("refuses malformed edits at the route with 400 INVALID_EDIT (P1-3)", async () => {
    const { store, explainer, infographic } = await setupGenerated();
    const infoUrl = `http://localhost/api/doc-overview/artifacts/${infographic.id}/review`;
    const exUrl = `http://localhost/api/doc-overview/artifacts/${explainer.id}/review`;
    const draft = store.getDraft(infographic.id);
    const rest = draft.content.findings.slice(1, 3);
    expect(rest).toHaveLength(2);

    // Empty findings: the edit would make the citation audit pass
    // vacuously, so the schema refuses it before any audit or store.
    const empty = await review(postJson(infoUrl, {
      action: "edit", editedContent: { kind: "infographic", findings: [] },
    }), params(infographic.id));
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("INVALID_EDIT");

    // A finding without citations.
    const noCitation = await review(postJson(infoUrl, {
      action: "edit",
      editedContent: {
        kind: "infographic",
        findings: [{ text: draft.content.findings[0].text, citations: [] }, ...rest],
      },
    }), params(infographic.id));
    expect(noCitation.status).toBe(400);
    expect((await noCitation.json()).code).toBe("INVALID_EDIT");

    // Non-string assertion text.
    const nonString = await review(postJson(infoUrl, {
      action: "edit",
      editedContent: {
        kind: "infographic",
        findings: [{ text: 42, citations: draft.content.findings[0].citations }, ...rest],
      },
    }), params(infographic.id));
    expect(nonString.status).toBe(400);
    expect((await nonString.json()).code).toBe("INVALID_EDIT");

    // Every explainer section emptied at once.
    const emptied = await review(postJson(exUrl, {
      action: "edit",
      editedContent: { kind: "explainer", summary: [], keyConcepts: [], context: [], glossary: [] },
    }), params(explainer.id));
    expect(emptied.status).toBe(400);
    expect((await emptied.json()).code).toBe("INVALID_EDIT");

    // Nothing was stored by any refused edit.
    expect(store.getDraft(infographic.id).version).toBe(1);
    expect(store.getDraft(explainer.id).version).toBe(1);

    // A valid constrained edit (3 findings, all cited) passes.
    const valid = await review(postJson(infoUrl, {
      action: "edit",
      editedContent: { kind: "infographic", findings: draft.content.findings.slice(0, 3) },
    }), params(infographic.id));
    expect(valid.status).toBe(200);
    expect((await valid.json()).artifact.version).toBe(2);
    expect(store.getDraft(infographic.id).content.findings).toHaveLength(3);
  });

  it("rejects unknown actions and bad ids with 400", async () => {
    const { explainer } = await setupGenerated();
    const badAction = await review(
      postJson(`http://localhost/api/doc-overview/artifacts/${explainer.id}/review`, { action: "publish" }),
      params(explainer.id),
    );
    expect(badAction.status).toBe(400);
    const badId = await getArtifact(
      new Request("http://localhost/api/doc-overview/artifacts/../escape"),
      params("../escape"),
    );
    expect(badId.status).toBe(400);
  });
});
