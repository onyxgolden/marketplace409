// POST /api/call-shield/imports/[id]/confirm — log a staged import on a
// case and mark it matched, in one request.
//
// Concurrency design (claim-first):
// - Two simultaneous confirms must never double-append. The import row is
//   claimed with a single conditional UPDATE:
//     SET matched_case_id = ?, dismissed = false
//     WHERE id = ? AND owner_id = ? AND matched_case_id IS NULL
//   Postgres re-evaluates the WHERE against the latest committed row version,
//   so exactly one claimant wins; the loser re-reads the row and returns
//   alreadyMatched. The event append happens only after winning the claim.
// - Crash windows: the claim commits before the event is appended, so a crash
//   can only leave "claimed but no event yet". A retry that finds the import
//   already matched to the requested case loads the case events: if the
//   sourceImportId event is present it returns alreadyMatched, otherwise it
//   appends the missing event (recovered: true).
// - The loser of a race may observe the winner's claim a moment before the
//   winner's event lands; it still returns success — the event follows within
//   the winner's request. No duplicate is ever appended.
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

function hasImportEvent(state, importId) {
  return (state.events || []).some((event) => event?.payload?.sourceImportId === importId);
}

async function appendImportEvent(supabaseClient, userId, caseId, state, importRow, importId) {
  // logCall validates the call fields and throws on invalid input.
  const result = logCall(state, {
    numberShown: importRow.phone_number,
    occurredAt: importRow.started_at ? new Date(importRow.started_at) : new Date(),
    direction: directionFor(importRow.call_type),
    businessNameStated: importRow.caller_name || "",
    sourceImportId: importId,
  });
  await persistEvent(supabaseClient, userId, caseId, result.event);
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

    if (importRow.matched_case_id) {
      if (importRow.matched_case_id !== caseId) {
        return NextResponse.json(
          { error: "This import is already logged on another case." },
          { status: 409 },
        );
      }
      // Already matched to this case: either a plain retry (event present) or
      // recovery after a crash between the claim and the event append.
      const state = await loadCaseState(supabaseClient, user.id, caseId);
      if (!state) return NextResponse.json({ error: "Case not found." }, { status: 404 });
      if (hasImportEvent(state, importId)) {
        return NextResponse.json({ success: true, alreadyMatched: true });
      }
      try {
        await appendImportEvent(supabaseClient, user.id, caseId, state, importRow, importId);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid call." },
          { status: 400 },
        );
      }
      return NextResponse.json({ success: true, recovered: true });
    }

    // Unmatched: validate the case before claiming, so a bad caseId never
    // leaves the import claimed.
    const state = await loadCaseState(supabaseClient, user.id, caseId);
    if (!state) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    // Claim the import. The IS NULL guard makes this the single serialization
    // point: exactly one concurrent confirmer wins.
    const { data: claimed, error: claimError } = await supabaseClient
      .from("android_call_imports")
      .update({ matched_case_id: caseId, dismissed: false })
      .eq("owner_id", user.id)
      .eq("id", importId)
      .is("matched_case_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      // Lost the race: re-read to report the actual outcome.
      const { data: rerow, error: rereadError } = await supabaseClient
        .from("android_call_imports")
        .select("id, matched_case_id")
        .eq("owner_id", user.id)
        .eq("id", importId)
        .maybeSingle();
      if (rereadError) throw rereadError;
      if (!rerow) return NextResponse.json({ error: "Import not found." }, { status: 404 });
      if (rerow.matched_case_id === caseId) {
        return NextResponse.json({ success: true, alreadyMatched: true });
      }
      return NextResponse.json(
        { error: "This import is already logged on another case." },
        { status: 409 },
      );
    }

    // Defensive: an event tagged with this import should not exist while the
    // import was unclaimed, but never append twice if one is somehow there.
    const recovered = hasImportEvent(state, importId);
    if (!recovered) {
      try {
        await appendImportEvent(supabaseClient, user.id, caseId, state, importRow, importId);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid call." },
          { status: 400 },
        );
      }
    }

    return NextResponse.json({ success: true, recovered: recovered || undefined });
  } catch (error) {
    console.error("Call Shield confirm import error", error);
    return NextResponse.json({ error: "Unable to confirm the import." }, { status: 500 });
  }
}
