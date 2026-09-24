// POST /api/call-shield/cases/[id]/events — append one event to a case.
// Slice A supports kind "call" (log a call on the case). The domain builds
// and validates the event; seq is assigned server-side.
import { NextResponse } from "next/server";
import { logCall } from "@/domains/callShield/callShieldCase";
import { guardCallShieldRequest } from "../../../_lib/auth.js";
import { loadCaseState, persistEvent } from "../../../_lib/persistence.js";

export async function POST(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id: caseId } = await params;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (body?.kind !== "call") {
    return NextResponse.json({ error: 'Only kind "call" is supported in this slice.' }, { status: 400 });
  }

  try {
    const state = await loadCaseState(supabaseClient, user.id, caseId);
    if (!state) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    let result = null;
    try {
      result = logCall(state, {
        numberShown: body.numberShown,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        direction: body.direction === "outgoing" ? "outgoing" : "incoming",
        pitchNotes: body.pitchNotes,
        businessNameStated: body.businessNameStated,
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid call." }, { status: 400 });
    }

    await persistEvent(supabaseClient, user.id, caseId, result.event);
    return NextResponse.json({ success: true, event: result.event }, { status: 201 });
  } catch (error) {
    console.error("Call Shield append event error", error);
    return NextResponse.json({ error: "Unable to log the call." }, { status: 500 });
  }
}
