import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  depositIsReconciled,
  serializeBankDeposit,
  validateBankDepositVoid,
} from "@/application/rental/bankDeposits";

const DEPOSIT_COLUMNS =
  "id, deposit_date, bank_account_id, memo, total_amount_cents, item_count, deposit_event_id, status, void_reason, voided_at, created_at, updated_at";
const DEPOSIT_ITEM_COLUMNS =
  "deposit_id, financial_event_id, seq, tender, check_number, received_from, amount_cents";

function mapRpcError(error) {
  if (!error) return null;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "P0001" && message.toLowerCase().includes("already reconciled")) return "reconciled";
  if (["22023", "22000", "P0002"].includes(code)) {
    return { status: 400, error: message || "The deposit could not be voided." };
  }
  return null;
}

async function findOwnedDeposit(supabaseClient, ownerId, depositId) {
  const { data, error } = await supabaseClient
    .from("rental_bank_deposits")
    .select(DEPOSIT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", depositId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadItems(supabaseClient, ownerId, depositId) {
  const { data, error } = await supabaseClient
    .from("rental_bank_deposit_items")
    .select(DEPOSIT_ITEM_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("deposit_id", depositId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return data || [];
}

// GET /api/rental/bank-deposits/[id] — one deposit with its items, for the
// deposit-slip print view. Read-only members may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const deposit = await findOwnedDeposit(supabaseClient, effectiveOwnerId, params.id);
    if (!deposit) return NextResponse.json({ error: "The deposit was not found." }, { status: 404 });
    const items = await loadItems(supabaseClient, effectiveOwnerId, deposit.id);
    return NextResponse.json({ success: true, deposit: serializeBankDeposit(deposit, { items }) });
  } catch (error) {
    console.error("Bank deposit detail error", error);
    return NextResponse.json({ error: "Unable to load the deposit." }, { status: 500 });
  }
}

// PATCH /api/rental/bank-deposits/[id] — void only: { action: "void", reason }.
// Reversal, never delete: the lump ledger event is soft-deleted and the
// receipts' deposit stamps are released. Read-only members cannot void.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
      return NextResponse.json({ error: "Read-only members cannot void deposits." }, { status: 403 });
    }
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }
    if (body?.action !== "void") {
      return NextResponse.json({ error: 'action must be "void".' }, { status: 400 });
    }

    const deposit = await findOwnedDeposit(supabaseClient, effectiveOwnerId, params.id);
    if (!deposit) return NextResponse.json({ error: "The deposit was not found." }, { status: 404 });

    const { valid, errors, value } = validateBankDepositVoid(body, deposit);
    if (!valid) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

    // Fail-closed on the reconciliation guard ahead of the RPC so the message
    // stays plain-English even if the snapshot table is missing.
    const { data: reconciliations } = await supabaseClient
      .from("bank_reconciliations")
      .select("status, cleared_event_ids")
      .eq("owner_id", effectiveOwnerId)
      .eq("bank_account_id", deposit.bank_account_id)
      .eq("status", "active");
    if (depositIsReconciled(deposit.deposit_event_id, reconciliations || [])) {
      return NextResponse.json({ error: "This deposit is already reconciled and cannot be voided." }, { status: 409 });
    }

    const { error: rpcError } = await supabaseClient.rpc("void_bank_deposit", {
      p_owner_id: effectiveOwnerId,
      p_deposit_id: deposit.id,
      p_reason: value.reason,
    });
    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped === "reconciled") {
        return NextResponse.json({ error: "This deposit is already reconciled and cannot be voided." }, { status: 409 });
      }
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      console.error("void_bank_deposit error", rpcError);
      return NextResponse.json({ error: "Unable to void the deposit." }, { status: 500 });
    }

    const voided = await findOwnedDeposit(supabaseClient, effectiveOwnerId, deposit.id);
    const items = await loadItems(supabaseClient, effectiveOwnerId, deposit.id);
    return NextResponse.json({ success: true, deposit: serializeBankDeposit(voided, { items }) });
  } catch (error) {
    console.error("Bank deposit void error", error);
    return NextResponse.json({ error: "Unable to void the deposit." }, { status: 500 });
  }
}
