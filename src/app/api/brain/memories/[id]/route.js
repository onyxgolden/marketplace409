// PATCH/DELETE /api/brain/memories/[id] — owner edit + delete (A6).
// Content-only edits: salience and provenance are system-owned, never
// rewritten by an edit. Cross-owner ids read as not-found, never leaked.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import { isBrainHarnessEnabled } from "@/domains/brain-conversation/config";
import { BRAIN_NOT_FOUND_MESSAGE } from "@/domains/brain-conversation/memoryStore";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function PATCH(request, { params }) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const content = String(body?.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "Memory text must not be empty." }, { status: 400 });
  }

  try {
    const entry = await authed.store.updateSemanticEntry(authed.ownerId, params.id, { content });
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    if (error?.message === BRAIN_NOT_FOUND_MESSAGE) {
      return NextResponse.json({ error: "That memory was not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to update your memory." }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  try {
    await authed.store.deleteSemanticEntry(authed.ownerId, params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.message === BRAIN_NOT_FOUND_MESSAGE) {
      return NextResponse.json({ error: "That memory was not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to delete your memory." }, { status: 500 });
  }
}
