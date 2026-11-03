// GET/POST /api/brain/episodes — append-only episodic log.
// Episodes are never edited in place; corrections are separate rows
// (see memoryStore.correctEpisode). Content + session id are required.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import { isBrainHarnessEnabled } from "@/domains/brain-conversation/config";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function GET() {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  try {
    const episodes = await authed.store.listEpisodes(authed.ownerId);
    return NextResponse.json({ success: true, episodes });
  } catch {
    return NextResponse.json({ error: "Unable to load your conversation history." }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const content = String(body?.content ?? "").trim();
  const sessionId = String(body?.sessionId ?? "").trim();
  if (!content || !sessionId) {
    return NextResponse.json(
      { error: "An episode needs both text and a session." },
      { status: 400 },
    );
  }

  try {
    const episode = await authed.store.appendEpisode(authed.ownerId, {
      content,
      sessionId,
      tags: Array.isArray(body?.tags) ? body.tags : [],
      candidateFacts: Array.isArray(body?.candidateFacts) ? body.candidateFacts : [],
      recordType: body?.recordType ?? null,
      recordId: body?.recordId ?? null,
    });
    return NextResponse.json({ success: true, episode }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save this conversation turn." }, { status: 500 });
  }
}
