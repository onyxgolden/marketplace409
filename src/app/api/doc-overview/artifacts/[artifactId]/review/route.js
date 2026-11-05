// FORGE Doc-to-Overview — slice B: review route.
//
// POST /api/doc-overview/artifacts/[artifactId]/review — one explicit
// curator action: edit, submit, approve, revise, keep, discard.
// Body: { action, reason?, editedContent? }. The actor is the
// authenticated user id from the session, never a body field. Approve
// and keep re-check source freshness and refuse stale artifacts;
// edits are re-audited against the recorded citation index.

import { NextResponse } from "next/server";
import { reviewArtifact } from "@/application/doc-overview/generate.js";
import {
  errorResponse,
  isRecordId,
  requireDocOverviewStore,
} from "../../../_helpers.js";

const ACTIONS = new Set(["edit", "submit", "approve", "revise", "keep", "discard"]);

export async function POST(request, { params }) {
  try {
    const { store, actorId, response } = await requireDocOverviewStore();
    if (response) return response;
    const artifactId = (await params)?.artifactId;
    if (!isRecordId(artifactId)) {
      return NextResponse.json({ error: "A valid artifact id is required.", code: "INVALID_ARTIFACT" }, { status: 400 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_ACTION" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !ACTIONS.has(body.action)) {
      return NextResponse.json({ error: "action must be one of: edit, submit, approve, revise, keep, discard.", code: "INVALID_ACTION" }, { status: 400 });
    }
    if (body.action === "edit" && (body.editedContent === undefined || body.editedContent === null)) {
      return NextResponse.json({ error: "editedContent is required for edit.", code: "INVALID_EDIT" }, { status: 400 });
    }
    const result = reviewArtifact({
      store,
      artifactId,
      action: body.action,
      actor: actorId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      editedContent: body.editedContent,
    });
    if (!result.ok) {
      const res = errorResponse(result.error);
      if (result.artifact) {
        // A refused approve/keep still returns the invalidated
        // artifact, so the caller can show its new status.
        const payload = await res.json();
        return NextResponse.json({ ...payload, artifact: result.artifact }, { status: res.status });
      }
      return res;
    }
    return NextResponse.json({ success: true, artifact: result.artifact });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
