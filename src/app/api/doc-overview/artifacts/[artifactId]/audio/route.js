// FORGE Doc-to-Overview — slice C: audio playback route.
//
// GET /api/doc-overview/artifacts/[artifactId]/audio — streams the
// synthesized WAV for preview playback (the <audio> element in the
// preview HTML points here). Owner-bound through the store: a foreign
// owner finds nothing. This is a preview aid, not an export — no
// status gate (a curator must be able to listen before approving).
// Script-only artifacts have no audio and answer 404.

import { NextResponse } from "next/server";
import { getArtifactAudio } from "@/application/doc-overview/generate.js";
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
    const result = getArtifactAudio({ store, artifactId });
    if (!result.ok) return errorResponse(result.error);
    return new Response(result.content, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "content-length": String(result.content.length),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
