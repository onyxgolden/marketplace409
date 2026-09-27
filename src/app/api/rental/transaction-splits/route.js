import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { validateSplits } from "@/application/rental/validateSplits";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change split lines." }, { status: 403 });
  }
  return null;
}

// The parent event must be an owned, non-deleted manual event — splits can
// never be hung on a foreign or imported event id.
async function ownManualEvent(supabaseClient, effectiveOwnerId, eventId) {
  const { data, error } = await supabaseClient
    .from("financial_events")
    .select("id, amount")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", eventId)
    .eq("source_system", "manual")
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

// GET /api/rental/transaction-splits?eventId= — list split lines for an event.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });
    if (!(await ownManualEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId))) {
      return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });
    }

    const { data, error } = await authenticated.supabaseClient
      .from("financial_event_splits")
      .select("id, normalized_category, amount, memo, created_at")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("parent_event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, splits: (data || []).map((row) => ({ ...row, amount: Number(row.amount) })) });
  } catch (error) {
    console.error("Transaction split query error", error);
    return NextResponse.json({ error: "Unable to load split lines." }, { status: 500 });
  }
}

// POST /api/rental/transaction-splits — replace an event's split lines.
// Body: { eventId, splits: [{ normalizedCategory, amount, memo? }] }.
// The split total must equal the transaction total to the cent; the replace is
// delete-then-insert so the lines always reflect exactly what was submitted.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });

    const event = await ownManualEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId);
    if (!event) return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });

    const { valid, errors, value } = validateSplits(body.splits, event.amount);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    const remove = await authenticated.supabaseClient
      .from("financial_event_splits")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("parent_event_id", eventId);
    if (remove.error) throw remove.error;

    const { data, error } = await authenticated.supabaseClient
      .from("financial_event_splits")
      .insert(value.splits.map((split) => ({
        owner_id: authenticated.effectiveOwnerId,
        parent_event_id: eventId,
        normalized_category: split.normalizedCategory,
        amount: split.amount,
        memo: split.memo,
      })))
      .select("id, normalized_category, amount, memo, created_at");
    if (error) throw error;

    return NextResponse.json({
      success: true,
      splits: (data || []).map((row) => ({ ...row, amount: Number(row.amount) })),
    });
  } catch (error) {
    console.error("Transaction split save error", error);
    return NextResponse.json({ error: "Unable to save split lines." }, { status: 500 });
  }
}
