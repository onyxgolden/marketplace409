import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { createLeaseDepositChoice } from "@/domains/deposit-choice";

// R24 — per-lease deposit choice record: traditional security deposit vs
// deposit-insurance product.
// GET  /api/rental/insurance/deposit-choice?leaseId=<optional>  — list (read-only members may read)
// POST /api/rental/insurance/deposit-choice                     — record/update the choice for a lease
//   body: { leaseId, choice: "traditional_security_deposit" | "deposit_insurance_product",
//           productReference?, note? }
// RECORD-ONLY: the money movement stays in the existing deposit flows. A
// deposit-insurance product choice must name the product reference; it is a
// record of the owner's choice, never a partner binding (partner products are
// hard-gated — see insurancePartnerProducts.js).

const TABLE = "rental_lease_deposit_choices";
const COLUMNS = "lease_id,choice,product_reference,note,recorded_by,recorded_at,created_at,updated_at";

async function requireWriter(authenticated) {
  const role = await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id });
  return role !== "read_only" ? null : NextResponse.json({ error: "Read-only members cannot record deposit choices." }, { status: 403 });
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);
    const leaseId = String(url.searchParams.get("leaseId") || "").trim();
    let query = authenticated.supabaseClient.from(TABLE).select(COLUMNS).eq("owner_id", authenticated.effectiveOwnerId);
    if (leaseId) query = query.eq("lease_id", leaseId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ choices: data || [] });
  } catch (error) {
    console.error("Deposit choice load error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load deposit choices." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireWriter(authenticated);
    if (gate) return gate;

    const body = await request.json();
    let choice;
    try {
      choice = createLeaseDepositChoice({ leaseId: body.leaseId, choice: body.choice, productReference: body.productReference });
    } catch (validationError) {
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }

    // The lease must belong to this workspace before a choice is recorded.
    const { data: lease, error: leaseError } = await authenticated.supabaseClient
      .from("rental_leases").select("id").eq("owner_id", authenticated.effectiveOwnerId).eq("id", choice.leaseId).maybeSingle();
    if (leaseError) throw leaseError;
    if (!lease) return NextResponse.json({ error: "Lease was not found in this workspace." }, { status: 404 });

    const row = {
      owner_id: authenticated.effectiveOwnerId,
      lease_id: choice.leaseId,
      choice: choice.choice,
      product_reference: choice.productReference,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      recorded_by: authenticated.user.id,
      recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await authenticated.supabaseClient
      .from(TABLE).upsert(row, { onConflict: "owner_id,lease_id" }).select(COLUMNS).single();
    if (error) throw error;
    return NextResponse.json({ success: true, choice: data });
  } catch (error) {
    console.error("Deposit choice save error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record the deposit choice." }, { status: 500 });
  }
}
