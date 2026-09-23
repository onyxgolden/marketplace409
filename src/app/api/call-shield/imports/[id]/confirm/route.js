// POST /api/call-shield/imports/[id]/confirm — log a staged import on a
// case and mark it matched, in one request.
//
// This replaces the old two-request confirm (append the timeline event,
// then mark the import matched). If the second request failed, the event
// was logged while the import stayed unmatched — and retrying appended a
// duplicate event. This endpoint is idempotent instead:
//
// - confirming an already-matched import returns success without appending;
// - a retry that arrives after the event was appended but before the import
//   was marked matched finds the existing event by its sourceImportId and
//   only marks the import matched, never appending twice.
import { NextResponse } from "next/server";
import { logCall } from "@/domains/callShield/callShieldCase";
import { guardCallShieldRequest } from "../../../_lib/auth.js";
import { loadCaseState, persistEvent } from "../../../_lib/persistence.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMPORT_COLUMNS =
  "id, phone_number, caller_name, started_at, duration_seconds, call_type, matched_case_id, dismissed";

function directionFor(callType) {
  return callType === "outgoing" ? "outgoing" : "incoming";
}

export async function POST(request, { params }) {
  const auth = await guardCallShieldRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;
  const { id: importId } = await params;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const caseId = body?.caseId;
  if (typeof caseId !== "string" || !UUID_RE.test(caseId)) {
    return NextResponse.json({ error: "caseId must be a UUID." }, { status: 400 });
  }

  try {
    const { data: importRow, error: importError } = await supabaseClient
      .from("android_call_imports")
      .select(IMPORT_COLUMNS)
      .eq("owner_id", user.id)
      .eq("id", importId)
      .maybeSingle();
    if (importError) throw importError;
    if (!importRow) return NextResponse.json({ error: "Import not found." }, { status: 404 });

    if (importRow.matched_case_id === caseId) {
      return NextResponse.json({ success: true, alreadyMatched: true });
    }
    if (importRow.matched_case_id) {
      return NextResponse.json(
        { error: "This import is already logged on another case." },
        { status: 409 },
      );
    }

    const state = await loadCaseState(supabaseClient, user.id, caseId);
    if (!state) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    // Crash recovery: the event was appended but the import was never marked
    // matched. Mark it now instead of appending a duplicate.
    const alreadyLogged = (state.events || []).some(
      (event) => event?.payload?.sourceImportId === importId,
    );
    if (!alreadyLogged) {
      let result = null;
      try {
        result = logCall(state, {
          numberShown: importRow.phone_number,
          occurredAt: importRow.started_at ? new Date(importRow.started_at) : new Date(),
          direction: directionFor(importRow.call_type),
          businessNameStated: importRow.caller_name || "",
          sourceImportId: importId,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid call." },
          { status: 400 },
        );
      }
      await persistEvent(supabaseClient, user.id, caseId, result.event);
    }

    const { data: updated, error: updateError } = await supabaseClient
      .from("android_call_imports")
      .update({ matched_case_id: caseId, dismissed: false })
      .eq("owner_id", user.id)
      .eq("id", importId)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ error: "Import not found." }, { status: 404 });

    return NextResponse.json({ success: true, recovered: alreadyLogged || undefined });
  } catch (error) {
    console.error("Call Shield confirm import error", error);
    return NextResponse.json({ error: "Unable to confirm the import." }, { status: 500 });
  }
}
