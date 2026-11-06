// FORGE Doc-to-Overview — slice B: single-artifact route.
//
// GET /api/doc-overview/artifacts/[artifactId] — the draft with its
// watermarked preview HTML. The preview is rendered server-side from
// the stored content (all source text escaped); a stale draft previews
// with a STALE banner instead of being presented as current.

import { NextResponse } from "next/server";
import { getArtifactPreview } from "@/application/doc-overview/generate.js";
import {
  errorResponse,
  isRecordId,
  requireDocOverviewStore,
} from "../../_helpers.js";

export async function GET(_request, { params }) {
  try {
    const { store, response } = await requireDocOverviewStore();
    if (response) return response;
    const artifactId = (await params)?.artifactId;
    if (!isRecordId(artifactId)) {
      return NextResponse.json({ error: "A valid artifact id is required.", code: "INVALID_ARTIFACT" }, { status: 400 });
    }
    const result = getArtifactPreview({ store, artifactId });
    if (!result.ok) return errorResponse(result.error);
    return NextResponse.json({
      success: true,
      artifact: result.artifact,
      stale: result.stale,
      html: result.html,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
