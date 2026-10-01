import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  serializeBankDeposit,
  validateBankDepositInput,
} from "@/application/rental/bankDeposits";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot record bank deposits." }, { status: 403 });
  }
  return null;
}

const DEPOSIT_COLUMNS =
  "id, deposit_date, bank_account_id, memo, total_amount_cents, item_count, deposit_event_id, status, void_reason, voided_at, created_at, updated_at";
const DEPOSIT_ITEM_COLUMNS =
  "deposit_id, financial_event_id, seq, tender, check_number, received_from, amount_cents";
// Receipts eligible for a deposit: active, non-deleted income not yet banked
// and not already on a deposit.
const UNDEPOSITED_EVENT_COLUMNS =
  "id, event_date, description, amount, payee, check_number, property_id, metadata";

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist") || message.includes("could not find the table");
}

function mapRpcError(error) {
  if (!error) return null;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "23505") return "duplicate";
  if (code === "P0001" && message.toLowerCase().includes("already reconciled")) return "reconciled";
  if (["22023", "22000", "P0002"].includes(code)) {
    return { status: 400, error: message || "The deposit could not be recorded." };
  }
  if (code === "42P01") return { status: 404, error: message };
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

async function loadItems(supabaseClient, ownerId, depositIds) {
  if (depositIds.length === 0) return [];
  const { data, error } = await supabaseClient
    .from("rental_bank_deposit_items")
    .select(DEPOSIT_ITEM_COLUMNS)
    .eq("owner_id", ownerId)
    .in("deposit_id", depositIds)
    .order("seq", { ascending: true });
  if (error) throw error;
  return data || [];
}

// GET /api/rental/bank-deposits?status=active|voided|all
//   → deposits with their items. Read-only members may read.
// GET /api/rental/bank-deposits?undeposited=true
//   → income receipts eligible for a new deposit (not banked, not deposited).
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    if (url.searchParams.get("undeposited") === "true") {
      return NextResponse.json({ success: true, receipts: await listUndeposited(supabaseClient, effectiveOwnerId) });
    }

    let deposits;
    try {
      const status = url.searchParams.get("status") || "all";
      let query = supabaseClient
        .from("rental_bank_deposits")
        .select(DEPOSIT_COLUMNS)
        .eq("owner_id", effectiveOwnerId);
      if (status === "active" || status === "voided") query = query.eq("status", status);
      query = query.order("deposit_date", { ascending: false }).order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      deposits = data || [];
    } catch (error) {
      if (isMissingTableError(error)) return NextResponse.json({ success: true, deposits: [] });
      throw error;
    }

    const items = await loadItems(supabaseClient, effectiveOwnerId, deposits.map((d) => d.id));
    const itemsByDeposit = new Map();
    for (const item of items) {
      if (!itemsByDeposit.has(item.deposit_id)) itemsByDeposit.set(item.deposit_id, []);
      itemsByDeposit.get(item.deposit_id).push(item);
    }

    return NextResponse.json({
      success: true,
      deposits: deposits.map((row) => serializeBankDeposit(row, { items: itemsByDeposit.get(row.id) || [] })),
    });
  } catch (error) {
    console.error("Bank deposits list error", error);
    return NextResponse.json({ error: "Unable to load bank deposits." }, { status: 500 });
  }
}

async function listUndeposited(supabaseClient, ownerId) {
  const { data, error } = await supabaseClient
    .from("financial_events")
    .select(UNDEPOSITED_EVENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("transaction_kind", "income")
    .eq("status", "active")
    .eq("is_deleted", false)
    .is("bank_account_id", null)
    .filter("metadata->>deposit_id", "is", null)
    .neq("normalized_category", "bank_deposit")
    .order("event_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((event) => ({
    eventId: event.id,
    eventDate: event.event_date,
    description: event.description,
    payee: event.payee,
    checkNumber: event.check_number,
    propertyId: event.property_id,
    amountCents: Math.round(Number(event.amount || 0) * 100),
  }));
}

// POST /api/rental/bank-deposits — batch receipts into one bank deposit.
// The id (client-generated, or created server-side) is the idempotency key: a
// retried submit with the same id returns the existing deposit instead of
// double-posting. Read-only members cannot post.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerError = await requireWriter(authenticated);
    if (writerError) return writerError;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    const eventIds = [...new Set((body?.items || []).map((item) => item?.eventId).filter(Boolean))];
    let events = [];
    if (eventIds.length > 0) {
      const { data, error } = await supabaseClient
        .from("financial_events")
        .select("id, amount, transaction_kind, bank_account_id, is_deleted, status, metadata")
        .eq("owner_id", effectiveOwnerId)
        .in("id", eventIds);
      if (error) throw error;
      events = data || [];
    }

    const { valid, errors, value } = validateBankDepositInput(body, { events });
    if (!valid) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }
    const depositId = value.id;

    // Idempotency: a retried submit returns the deposit already recorded.
    try {
      const existing = await findOwnedDeposit(supabaseClient, effectiveOwnerId, depositId);
      if (existing) {
        const items = await loadItems(supabaseClient, effectiveOwnerId, [depositId]);
        return NextResponse.json({
          success: true,
          deduplicated: true,
          deposit: serializeBankDeposit(existing, { items }),
        });
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: "Bank deposits aren't available yet (the database update hasn't been applied)." }, { status: 503 });
      }
      throw error;
    }

    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("record_bank_deposit", {
      p_owner_id: effectiveOwnerId,
      p_deposit: {
        id: depositId,
        depositDate: value.depositDate,
        bankAccountId: value.bankAccountId,
        memo: value.memo || null,
        items: value.items.map((item) => ({
          eventId: item.eventId,
          tender: item.tender,
          checkNumber: item.checkNumber || null,
          receivedFrom: item.receivedFrom || null,
          amountCents: item.amountCents,
        })),
      },
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped === "duplicate") {
        const winner = await findOwnedDeposit(supabaseClient, effectiveOwnerId, depositId);
        if (winner) {
          const items = await loadItems(supabaseClient, effectiveOwnerId, [depositId]);
          return NextResponse.json({
            success: true,
            deduplicated: true,
            deposit: serializeBankDeposit(winner, { items }),
          });
        }
        return NextResponse.json({ error: "A deposit with this id already exists." }, { status: 409 });
      }
      if (mapped && mapped !== "reconciled") {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      console.error("record_bank_deposit error", rpcError);
      return NextResponse.json({ error: "Unable to record the deposit." }, { status: 500 });
    }

    const createdId = rpcData?.depositId || depositId;
    const created = await findOwnedDeposit(supabaseClient, effectiveOwnerId, createdId);
    if (!created) {
      console.error("record_bank_deposit succeeded but the deposit row is missing", { createdId });
      return NextResponse.json({ error: "Unable to record the deposit." }, { status: 500 });
    }
    const items = await loadItems(supabaseClient, effectiveOwnerId, [createdId]);

    return NextResponse.json(
      { success: true, deposit: serializeBankDeposit(created, { items }) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Bank deposit create error", error);
    return NextResponse.json({ error: "Unable to record the deposit." }, { status: 500 });
  }
}
