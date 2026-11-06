// FORGE Doc-to-Overview — slice B: artifact collection route.
//
// GET  /api/doc-overview/artifacts — list the owner's drafts.
// POST /api/doc-overview/artifacts — generate explainer + infographic
//   drafts on a saved source-set manifest.
//   Body: { manifestId, documents: { [documentId]: { text, pages? } } }
//   The documents are the curator-supplied source texts; generation
//   hash-verifies them against the manifest and generates nothing when
//   a source changed. No network, no model call, no paid service.

import { NextResponse } from "next/server";
import {
  generateDrafts,
  listArtifacts,
} from "@/application/doc-overview/generate.js";
import {
  errorResponse,
  requireDocOverviewStore,
} from "../_helpers.js";

export async function GET() {
  try {
    const { store, response } = await requireDocOverviewStore();
    if (response) return response;
    const result = listArtifacts({ store });
    return NextResponse.json({ success: true, artifacts: result.artifacts });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { store, actorId, response } = await requireDocOverviewStore();
    if (response) return response;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_DOCUMENTS" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object.", code: "INVALID_DOCUMENTS" }, { status: 400 });
    }
    if (typeof body.manifestId !== "string" || body.manifestId.trim() === "") {
      return NextResponse.json({ error: "manifestId is required.", code: "INVALID_MANIFEST" }, { status: 400 });
    }
    if (!body.documents || typeof body.documents !== "object" || Array.isArray(body.documents)) {
      return NextResponse.json({ error: "documents (texts by document id) are required.", code: "INVALID_DOCUMENTS" }, { status: 400 });
    }
    const result = generateDrafts({
      store,
      manifestId: body.manifestId,
      documents: body.documents,
      curator: actorId,
    });
    if (!result.ok) return errorResponse(result.error);
    return NextResponse.json({ success: true, artifacts: result.artifacts }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
