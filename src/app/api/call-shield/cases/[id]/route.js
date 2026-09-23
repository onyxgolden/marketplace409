// GET /api/call-shield/cases/[id] — one case, rebuilt from its event
// timeline via the domain (the timeline is the source of truth).
import { NextResponse } from "next/server";
import { guardCallShieldRequest } from "../../_lib/auth.js";
import { CASE_COLUMNS, EVENT_COLUMNS, rebuildCaseState, serializeCase } from "../../_lib/persistence.js";

export async function GET(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id: caseId } = await params;

  try {
    const { data: row, error: caseError } = await supabaseClient
      .from("call_shield_cases")
      .select(CASE_COLUMNS)
      .eq("owner_id", user.id)
      .eq("id", caseId)
      .maybeSingle();
    if (caseError) throw caseError;
    if (!row) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const { data: eventRows, error: eventsError } = await supabaseClient
      .from("call_shield_case_events")
      .select(EVENT_COLUMNS)
      .eq("owner_id", user.id)
      .eq("case_id", caseId)
      .order("seq", { ascending: true });
    if (eventsError) throw eventsError;

    const state = rebuildCaseState(eventRows || []);
    return NextResponse.json({ success: true, item: serializeCase(row, state) });
  } catch (error) {
    console.error("Call Shield case detail error", error);
    return NextResponse.json({ error: "Unable to load the case." }, { status: 500 });
  }
}
