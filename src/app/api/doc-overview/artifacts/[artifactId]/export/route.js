// FORGE Doc-to-Overview — slice B + slice C: export route.
//
// GET /api/doc-overview/artifacts/[artifactId]/export — downloads the
// artifact file (Markdown for an explainer, SVG for an infographic,
// WAV for synthesized audio, transcript Markdown for a script-only
// audio artifact). Approved or kept artifacts only; a stale artifact
// is invalidated and refused. Drafts are previewed, never exported.

import { NextResponse } from "next/server";
import { exportArtifact } from "@/application/doc-overview/generate.js";
import {
  errorResponse,
  isRecordId,
  requireDocOverviewStore,
} from "../../../_helpers.js";

export async function GET(_request, { params }) {
  try {
    const { store, response } = await requireDocOverviewStore();
    if (response) return response;
    const artifactId = (await params)?.artifactId;
    if (!isRecordId(artifactId)) {
      return NextResponse.json({ error: "A valid artifact id is required.", code: "INVALID_ARTIFACT" }, { status: 400 });
    }
    const result = exportArtifact({ store, artifactId });
    if (!result.ok) return errorResponse(result.error);
    return new Response(result.content, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "content-disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
