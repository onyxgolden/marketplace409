// FORGE Doc-to-Overview — slice B: workbench page test.
// Renders the server page to static markup with mocked auth and a
// temp store root; verifies the owner-scoped list reaches the
// workbench and unauthenticated requests redirect to /auth.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn(() => { throw new Error("REDIRECT:/auth"); }));
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: authMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import DocOverviewPage from "./page.jsx";
import { createDraftStore } from "@/application/doc-overview/draftStore.js";
import { pickSources } from "@/application/doc-overview/picker.js";
import { createDocOverviewStore, generateDrafts } from "@/application/doc-overview/generate.js";

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

function seedArtifacts(root) {
  const store = createDraftStore(root, { ownerId: "owner-1" });
  const picked = pickSources({
    name: "Energy in living cells",
    ownerId: "owner-1",
    curator: { id: "curator-1" },
    purpose: "Page test fixture",
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
  const genStore = createDocOverviewStore({ ownerId: "owner-1" });
  const generated = generateDrafts({
    store: genStore,
    manifestId: picked.manifest.id,
    documents: { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } },
    curator: "curator-1",
  });
  if (!generated.ok) throw new Error(`fixture generate failed: ${JSON.stringify(generated.error)}`);
  return generated.artifacts;
}

describe("doc-overview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const root = mkdtempSync(path.join(tmpdir(), "doc-overview-page-"));
    process.env.DOC_OVERVIEW_ROOT = root;
    authMock.mockResolvedValue({ user: { id: "curator-1" }, effectiveOwnerId: "owner-1" });
    seedArtifacts(root);
  });

  it("lists the owner's drafts for an authenticated owner", async () => {
    const html = renderToStaticMarkup(await DocOverviewPage());
    expect(html).toContain("Doc-to-Overview");
    expect(html).toContain("explainer");
    expect(html).toContain("infographic");
    expect(html).toContain("Generate drafts");
    expect(html).not.toContain("Photosynthesis is the process");
  });

  it("redirects unauthenticated visitors to /auth", async () => {
    authMock.mockResolvedValue({ response: new Response("unauthenticated", { status: 401 }) });
    await expect(DocOverviewPage()).rejects.toThrow("REDIRECT:/auth");
    expect(redirectMock).toHaveBeenCalledWith("/auth");
  });
});
