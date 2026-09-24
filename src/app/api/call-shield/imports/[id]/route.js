// PATCH /api/call-shield/imports/[id] — confirm a case association
// ({ matchedCaseId }) or dismiss ({ dismissed: true }). Confirming does NOT
// write the timeline event by itself: the client then calls
// POST /api/call-shield/cases/[id]/events, so every timeline write goes
// through the domain. DELETE removes a staged row.
import { NextResponse } from "next/server";
import { guardCallShieldRequest } from "../../_lib/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id } = await params;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const patch = {};
  if (body?.matchedCaseId !== undefined) {
    if (body.matchedCaseId !== null && !UUID_RE.test(String(body.matchedCaseId))) {
      return NextResponse.json({ error: "matchedCaseId must be a UUID or null." }, { status: 400 });
    }
    // The case must belong to the owner, otherwise the association is refused.
    if (body.matchedCaseId) {
      const { data: caseRow, error: caseError } = await supabaseClient
        .from("call_shield_cases")
        .select("id")
        .eq("owner_id", user.id)
        .eq("id", body.matchedCaseId)
        .maybeSingle();
      if (caseError) return NextResponse.json({ error: "Unable to verify the case." }, { status: 500 });
      if (!caseRow) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }
    patch.matched_case_id = body.matchedCaseId;
  }
  if (body?.dismissed !== undefined) {
    patch.dismissed = body.dismissed === true;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseClient
      .from("android_call_imports")
      .update(patch)
      .eq("owner_id", user.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Import not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Call Shield update import error", error);
    return NextResponse.json({ error: "Unable to update the import." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id } = await params;

  try {
    const { data, error } = await supabaseClient
      .from("android_call_imports")
      .delete()
      .eq("owner_id", user.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Import not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Call Shield delete import error", error);
    return NextResponse.json({ error: "Unable to delete the import." }, { status: 500 });
  }
}
