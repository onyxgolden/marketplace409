import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

// R23 — void a 1099 payment entry (reversal-friendly: status -> 'voided' with a
// reason, never a hard delete). Writer role only.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot void 1099 payment entries." }, { status: 403 });
  }
  return null;
}

const ENTRY_COLUMNS =
  "id, recipient_id, tax_year, payment_date, amount_cents, source, source_ref, memo, status, void_reason, voided_at, created_at, updated_at";

export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const toStatus = typeof body.status === "string" ? body.status.trim() : "";
    if (toStatus !== "voided") {
      return NextResponse.json({ error: "Only voiding is supported (status must be 'voided')." }, { status: 400 });
    }
    const voidReason = typeof body.voidReason === "string" ? body.voidReason.trim() : "";
    if (!voidReason) {
      return NextResponse.json({ error: "A void reason is required." }, { status: 400 });
    }

    const { data: existing, error: findError } = await supabaseClient
      .from("rental_1099_payment_entries")
      .select("id, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    if (existing.status === "voided") {
      return NextResponse.json({ error: "This entry is already voided." }, { status: 409 });
    }

    const { data, error } = await supabaseClient
      .from("rental_1099_payment_entries")
      .update({ status: "voided", void_reason: voidReason, voided_at: new Date().toISOString() })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, entry: data });
  } catch {
    return NextResponse.json({ error: "Unable to void the 1099 payment entry." }, { status: 500 });
  }
}
