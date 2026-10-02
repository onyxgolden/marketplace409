import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { buildPaymentEntryId, validatePaymentEntryInput } from "@/application/rental/tax1099";

// R23 — manual/adjustment reportable payment entries (owner distributions today;
// R9 disbursements land here with source='r9_owner_distribution' when R9 merges).
// GET: list entries (filters: recipientId, taxYear). Read-only members may read.
// POST: record an entry. Writer role only. Reversal = void (PATCH on [id]),
// never delete.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot record 1099 payment entries." }, { status: 403 });
  }
  return null;
}

const ENTRY_COLUMNS =
  "id, recipient_id, tax_year, payment_date, amount_cents, source, source_ref, memo, status, void_reason, voided_at, created_at, updated_at";

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const recipientId = url.searchParams.get("recipientId");
    const taxYear = url.searchParams.get("taxYear");

    let query = supabaseClient
      .from("rental_1099_payment_entries")
      .select(ENTRY_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .order("payment_date", { ascending: false });
    if (recipientId) query = query.eq("recipient_id", recipientId);
    if (taxYear) query = query.eq("tax_year", Number(taxYear));

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, entries: data || [] });
  } catch {
    return NextResponse.json({ error: "Unable to load 1099 payment entries." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const validation = validatePaymentEntryInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    }
    const value = validation.value;

    // The recipient must exist and belong to this workspace.
    const { data: recipient, error: recipientError } = await supabaseClient
      .from("rental_1099_recipients")
      .select("id")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", value.recipientId)
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (!recipient) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });

    const row = {
      owner_id: effectiveOwnerId,
      id: buildPaymentEntryId(),
      recipient_id: value.recipientId,
      tax_year: value.taxYear,
      payment_date: value.paymentDate,
      amount_cents: value.amountCents,
      source: value.source,
      source_ref: value.sourceRef,
      memo: value.memo,
      created_by: authenticated.user.id,
    };

    const { data, error } = await supabaseClient
      .from("rental_1099_payment_entries")
      .insert(row)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, entry: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to record the 1099 payment entry." }, { status: 500 });
  }
}
