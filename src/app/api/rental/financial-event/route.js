import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";

// PATCH /api/rental/financial-event — the register's cleared flag.
// Body: { id, cleared } → sets cleared and cleared_at (now() when clearing,
// null when un-clearing). Owner-scoped to the effective workspace owner;
// read-only workspace members get a 403, mirroring the manual-financial-event
// route's guard.
export async function PATCH(request) {
  try {
    const a = await createAuthenticatedForgeApplication();
    if (a.response) return a.response;

    // R17: toggling the cleared flag needs payments.record (was: read_only-only check),
    // mirroring the manual-financial-event route's guard.
    const clearedGate = await requireRentalPermission({ authenticated: a, request, permission: "payments.record" });
    if (clearedGate.response) return clearedGate.response;

    const body = await request.json();
    const id = String(body?.id ?? "").trim();
    const cleared = body?.cleared;
    if (!id) return NextResponse.json({ error: "A transaction id is required." }, { status: 400 });
    if (typeof cleared !== "boolean") return NextResponse.json({ error: "cleared must be true or false." }, { status: 400 });

    const { data: existing, error: lookupError } = await a.supabaseClient
      .from("financial_events")
      .select("id, cleared")
      .eq("owner_id", a.effectiveOwnerId)
      .eq("id", id)
      .limit(1);
    if (lookupError) throw lookupError;
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });
    }

    const patch = {
      cleared,
      cleared_at: cleared ? new Date().toISOString() : null,
      updated_by: a.user.id,
    };
    const { data, error } = await a.supabaseClient
      .from("financial_events")
      .update(patch)
      .eq("owner_id", a.effectiveOwnerId)
      .eq("id", id)
      .select("id, cleared, cleared_at")
      .limit(1);
    if (error) throw error;

    return NextResponse.json({ success: true, event: (data || [])[0] || null });
  } catch (error) {
    console.error("Financial event cleared-flag error", error);
    return NextResponse.json({ error: "Unable to update the transaction." }, { status: 500 });
  }
}
