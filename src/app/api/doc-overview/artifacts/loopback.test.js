// FORGE Doc-to-Overview — slice B: real-server loopback proof.
//
// The route handlers are exercised over a real HTTP round-trip on
// 127.0.0.1 (ephemeral port) with the real filesystem store — not
// direct function calls. Auth is mocked (as in the other route tests);
// everything else is real: HTTP parsing, Request/Response handling,
// JSON bodies, the identity-bound store on disk, and the full
// generate → preview → submit → approve → export flow.
//
// No network leaves the machine (loopback only) and no paid service
// is involved.

import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: authMock,
}));

import { GET as listArtifacts, POST as generateArtifacts } from "./route.js";
import { GET as getArtifact } from "./[artifactId]/route.js";
import { POST as reviewArtifact } from "./[artifactId]/review/route.js";
import { GET as exportArtifact } from "./[artifactId]/export/route.js";
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

let baseUrl;
let server;

function params(artifactId) {
  return { params: Promise.resolve({ artifactId }) };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = `http://127.0.0.1${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: body.length > 0 ? body : undefined,
      });
      let response;
      const artifactsMatch = req.url.match(/^\/api\/doc-overview\/artifacts(?:\/([^/]+)(\/review|\/export)?)?$/);
      if (!artifactsMatch) {
        response = new Response("not found", { status: 404 });
      } else if (artifactsMatch[1] === undefined) {
        response = req.method === "GET" ? await listArtifacts() : await generateArtifacts(request);
      } else if (artifactsMatch[2] === "/review") {
        response = await reviewArtifact(request, params(decodeURIComponent(artifactsMatch[1])));
      } else if (artifactsMatch[2] === "/export") {
        response = await exportArtifact(request, params(decodeURIComponent(artifactsMatch[1])));
      } else {
        response = await getArtifact(request, params(decodeURIComponent(artifactsMatch[1])));
      }
      const text = await response.text();
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(text);
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("doc-overview loopback (real HTTP on 127.0.0.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "curator-1" }, effectiveOwnerId: "owner-1" });
  });

  it("runs generate → preview → submit → approve → export over HTTP", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "doc-overview-loopback-"));
    process.env.DOC_OVERVIEW_ROOT = root;
    const store = createDraftStore(root, { ownerId: "owner-1" });
    const picked = pickSources({
      name: "Energy in living cells",
      ownerId: "owner-1",
      curator: { id: "curator-1" },
      purpose: "Loopback fixture",
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

    const generatedRes = await fetch(`${baseUrl}/api/doc-overview/artifacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestId: picked.manifest.id,
        documents: { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } },
      }),
    });
    expect(generatedRes.status).toBe(201);
    const generated = await generatedRes.json();
    expect(generated.artifacts).toHaveLength(2);
    const explainer = generated.artifacts.find((a) => a.type === "explainer");
    const infographic = generated.artifacts.find((a) => a.type === "infographic");

    const listedRes = await fetch(`${baseUrl}/api/doc-overview/artifacts`);
    expect(listedRes.status).toBe(200);
    expect((await listedRes.json()).artifacts).toHaveLength(2);

    const previewRes = await fetch(`${baseUrl}/api/doc-overview/artifacts/${explainer.id}`);
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.html).toContain("DRAFT — NOT VERIFIED");
    expect(preview.html).toContain("Photosynthesis");

    const submitRes = await fetch(`${baseUrl}/api/doc-overview/artifacts/${explainer.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    expect(submitRes.status).toBe(200);
    expect((await submitRes.json()).artifact.status).toBe("needs_review");

    const approveRes = await fetch(`${baseUrl}/api/doc-overview/artifacts/${explainer.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).artifact.status).toBe("approved");

    const exportRes = await fetch(`${baseUrl}/api/doc-overview/artifacts/${explainer.id}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toContain("text/markdown");
    const markdown = await exportRes.text();
    expect(markdown).toContain("# Energy in living cells");
    expect(markdown).toContain("## References");

    const infographicExportRes = await fetch(`${baseUrl}/api/doc-overview/artifacts/${infographic.id}/export`);
    expect(infographicExportRes.status).toBe(409);

    // The store on disk holds the approved artifact after the HTTP flow.
    const reloaded = store.getDraft(explainer.id);
    expect(reloaded.status).toBe("approved");
    expect(reloaded.reviewHistory.map((r) => r.action)).toEqual(["submit", "approve"]);
  });
});
