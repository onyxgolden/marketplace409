// GET /api/call-shield/cases/[id] — one case, rebuilt from its event
// timeline via the domain (the timeline is the source of truth).
// PATCH /api/call-shield/cases/[id] — rename the case or edit its notes
// ({ reportedBusinessName?, notes? }). Header-row fields only: the event
// timeline is append-only and is never rewritten by a rename.
// DELETE /api/call-shield/cases/[id] — delete the case. Its timeline events
// are deleted with it: an event row without its case is meaningless (the
// timeline is the source of truth) and would otherwise leak as an orphan.
// Staged imports previously matched to the case are released back to the
// review queue (matched_case_id cleared) instead of left dangling.
// The three writes are sequenced least-to-most destructive (imports release,
// then case row, then events) so a mid-sequence failure never destroys the
// timeline while leaving a visible case behind. A single atomic RPC would be
// stricter; that needs a migration and is queued as follow-up work.
import { NextResponse } from "next/server";
import { guardCallShieldRequest } from "../../_lib/auth.js";
import { CASE_COLUMNS, EVENT_COLUMNS, rebuildCaseState, serializeCase } from "../../_lib/persistence.js";

async function findOwnedCase(supabaseClient, ownerId, caseId) {
  const { data: row, error } = await supabaseClient
    .from("call_shield_cases")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw error;
  return row;
}

async function readCase(supabaseClient, ownerId, caseId) {
  const { data: row, error: caseError } = await supabaseClient
    .from("call_shield_cases")
    .select(CASE_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) throw caseError;
  if (!row) return null;

  const { data: eventRows, error: eventsError } = await supabaseClient
    .from("call_shield_case_events")
    .select(EVENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("case_id", caseId)
    .order("seq", { ascending: true });
  if (eventsError) throw eventsError;

  return serializeCase(row, rebuildCaseState(eventRows || []));
}

export async function GET(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id: caseId } = await params;

  try {
    const item = await readCase(supabaseClient, user.id, caseId);
    if (!item) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Call Shield case detail error", error);
    return NextResponse.json({ error: "Unable to load the case." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
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

  const updates = {};
  if (body?.reportedBusinessName !== undefined) {
    const name =
      typeof body.reportedBusinessName === "string" ? body.reportedBusinessName.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "reportedBusinessName must be a non-empty string." },
        { status: 400 },
      );
    }
    updates.reported_business_name = name.slice(0, 200);
  }
  if (body?.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
    }
    updates.notes = body.notes;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update: send reportedBusinessName and/or notes." },
      { status: 400 },
    );
  }
  updates.updated_at = new Date().toISOString();

  try {
    const owned = await findOwnedCase(supabaseClient, user.id, caseId);
    if (!owned) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const { error: updateError } = await supabaseClient
      .from("call_shield_cases")
      .update(updates)
      .eq("owner_id", user.id)
      .eq("id", caseId);
    if (updateError) throw updateError;

    const item = await readCase(supabaseClient, user.id, caseId);
    if (!item) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("Call Shield case update error", error);
    return NextResponse.json({ error: "Unable to update the case." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id: caseId } = await params;

  try {
    const owned = await findOwnedCase(supabaseClient, user.id, caseId);
    if (!owned) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    // Order matters: the three writes below are not wrapped in a DB
    // transaction (that would need a migration + RPC), so sequence them
    // from least to most destructive. Releasing imports first is harmless
    // if a later step fails (the case and its timeline are still intact,
    // the imports just sit in the review queue). The case row is deleted
    // before its events: if the case delete fails, the timeline is
    // untouched and nothing is lost. Events go last — a failure there
    // leaves orphan event rows, which are invisible (every read joins
    // through the case) and far better than a visible case shell whose
    // timeline was destroyed.
    // Release staged imports matched to this case back to the review queue
    // instead of leaving matched_case_id dangling.
    const { error: importsError } = await supabaseClient
      .from("android_call_imports")
      .update({ matched_case_id: null })
      .eq("owner_id", user.id)
      .eq("matched_case_id", caseId);
    if (importsError) throw importsError;

    const { error: caseError } = await supabaseClient
      .from("call_shield_cases")
      .delete()
      .eq("owner_id", user.id)
      .eq("id", caseId);
    if (caseError) throw caseError;

    // Timeline events go with the case — see the header comment.
    const { error: eventsError } = await supabaseClient
      .from("call_shield_case_events")
      .delete()
      .eq("owner_id", user.id)
      .eq("case_id", caseId);
    if (eventsError) throw eventsError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Call Shield case delete error", error);
    return NextResponse.json({ error: "Unable to delete the case." }, { status: 500 });
  }
}
