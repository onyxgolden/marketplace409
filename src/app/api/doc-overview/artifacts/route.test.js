// FORGE Doc-to-Overview — slice B: artifact collection route tests.
// Auth is mocked (pattern from the rental documents route tests);
// the store root is a temp directory via DOC_OVERVIEW_ROOT.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: authMock,
}));

import { GET, POST } from "./route.js";
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

function setupManifest(ownerId = "owner-1") {
  const root = mkdtempSync(path.join(tmpdir(), "doc-overview-route-"));
  process.env.DOC_OVERVIEW_ROOT = root;
  const store = createDraftStore(root, { ownerId });
  const picked = pickSources({
    name: "Energy in living cells",
    ownerId,
    curator: { id: "curator-1" },
    purpose: "Route test fixture",
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
  return { root, manifest: picked.manifest };
}

function request(url, init) {
  return new Request(url, init);
}

describe("doc-overview artifacts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "curator-1" }, effectiveOwnerId: "owner-1" });
  });

  it("generates explainer + infographic drafts (201) and lists them", async () => {
    const { manifest } = setupManifest();
    const generated = await POST(request("http://localhost/api/doc-overview/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestId: manifest.id,
        documents: { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } },
      }),
    }));
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json();
    expect(generatedBody.artifacts).toHaveLength(3);
    expect(generatedBody.artifacts.map((a) => a.type).sort()).toEqual(["audio", "explainer", "infographic"]);

    const listed = await GET();
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.artifacts).toHaveLength(3);
    expect(listedBody.artifacts[0].content).toBeUndefined();
  });

  it("refuses generation on a changed source (409 STALE_SOURCE)", async () => {
    const { manifest } = setupManifest();
    const res = await POST(request("http://localhost/api/doc-overview/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestId: manifest.id,
        documents: { doc_a: { text: `${DOC_A_TEXT}\nAn added sentence.` }, doc_b: { text: DOC_B_TEXT } },
      }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE_SOURCE");
  });

  it("returns 404 for a manifest belonging to another owner", async () => {
    const { manifest } = setupManifest("owner-1");
    authMock.mockResolvedValue({ user: { id: "curator-2" }, effectiveOwnerId: "owner-2" });
    const res = await POST(request("http://localhost/api/doc-overview/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestId: manifest.id,
        documents: { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } },
      }),
    }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({
      response: NextResponse.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    setupManifest();
    const res = await POST(request("http://localhost/api/doc-overview/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: {} }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_MANIFEST");
  });
});
