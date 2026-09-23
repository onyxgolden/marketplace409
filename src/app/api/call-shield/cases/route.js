// GET /api/call-shield/cases — the owner's cases, newest first.
// POST /api/call-shield/cases — open a case ({ reportedBusinessName, notes? }).
import { NextResponse } from "next/server";
import { openCase } from "@/domains/callShield/callShieldCase";
import { guardCallShieldRequest } from "../_lib/auth.js";
import { CASE_COLUMNS, persistEvent, serializeCase } from "../_lib/persistence.js";

export async function GET(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const { data: rows, error } = await supabaseClient
      .from("call_shield_cases")
      .select("id, reported_business_name, notes, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ success: true, items: rows || [] });
  } catch (error) {
    console.error("Call Shield cases error", error);
    return NextResponse.json({ error: "Unable to load cases." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  let opened = null;
  try {
    opened = openCase({
      reportedBusinessName: body?.reportedBusinessName,
      notes: body?.notes,
      ownerId: user.id,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid case." }, { status: 400 });
  }

  try {
    const { error: caseError } = await supabaseClient.from("call_shield_cases").insert({
      id: opened.event.payload.caseId,
      owner_id: user.id,
      reported_business_name: opened.event.payload.reportedBusinessName,
      notes: opened.event.payload.notes || null,
    });
    if (caseError) throw caseError;
    try {
      await persistEvent(supabaseClient, user.id, opened.event.payload.caseId, opened.event);
    } catch (eventError) {
      // Never leave a header row with no timeline behind it.
      await supabaseClient
        .from("call_shield_cases")
        .delete()
        .eq("owner_id", user.id)
        .eq("id", opened.event.payload.caseId);
      throw eventError;
    }

    const { data: row, error: readError } = await supabaseClient
      .from("call_shield_cases")
      .select(CASE_COLUMNS)
      .eq("owner_id", user.id)
      .eq("id", opened.event.payload.caseId)
      .single();
    if (readError) throw readError;
    return NextResponse.json({ success: true, item: serializeCase(row, opened.state) }, { status: 201 });
  } catch (error) {
    console.error("Call Shield create case error", error);
    return NextResponse.json({ error: "Unable to create the case." }, { status: 500 });
  }
}
