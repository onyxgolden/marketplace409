// POST /api/brain/chat — chat turn without answering (yet).
//
// Appends the turn as an episode, runs per-turn retrieval (semantic entries
// ranked by the message plus the 3 most recent episodes), and runs the
// model-payload fence over the working set on the real path — so the fence
// is exercised before any model adapter ever exists.
//
// Answering is NOT activated: the route returns answeringEnabled: false
// with a plain-words notice and never fakes an answer. A real answering
// model adapter is separate future work needing its own authorization,
// and it must pass through fencing.js.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import {
  DEFAULT_WORKING_SET_SIZE,
  isBrainHarnessEnabled,
} from "@/domains/brain-conversation/config";
import { assertModelPayloadSafe } from "@/domains/brain-conversation/fencing";
import { selectWorkingSet } from "@/domains/brain-conversation/retrieval";
import { renderWorkingSetPlainWords } from "@/domains/brain-conversation/plainWords";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function POST(request) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const message = String(body?.message ?? "").trim();
  const sessionId = String(body?.sessionId ?? "").trim();
  if (!message || !sessionId) {
    return NextResponse.json(
      { error: "A chat turn needs both a message and a session." },
      { status: 400 },
    );
  }

  try {
    await authed.store.appendEpisode(authed.ownerId, {
      content: message,
      sessionId,
      tags: ["chat"],
      candidateFacts: Array.isArray(body?.candidateFacts) ? body.candidateFacts : [],
    });
    const semantic = await authed.store.listSemanticEntries(authed.ownerId);
    const episodes = await authed.store.listEpisodes(authed.ownerId);
    const workingSet = [
      ...selectWorkingSet(semantic, {
        query: message,
        limit: DEFAULT_WORKING_SET_SIZE,
      }),
      ...episodes.slice(0, 3),
    ];
    // The fence executes here, on the real path, before anything could
    // ever reach a model. A fenced entry fails the turn loudly.
    assertModelPayloadSafe(workingSet);
    return NextResponse.json({
      success: true,
      answeringEnabled: false,
      answer: null,
      notice:
        "Brain answering is not activated yet. Your message was saved to your conversation history.",
      workingSetPlainWords: renderWorkingSetPlainWords(workingSet),
      sessionId,
    });
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Refusing model payload")) {
      return NextResponse.json(
        { error: "This conversation turn was refused: a recalled memory is not safe to send onward." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Unable to save this chat turn." }, { status: 500 });
  }
}
