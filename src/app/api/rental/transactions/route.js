import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { validateTransaction } from "@/application/rental/validateTransaction";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change transactions." }, { status: 403 });
  }
  return null;
}

function toRow({ ownerId, userId, value }) {
  return {
    owner_id: ownerId,
    property_id: value.propertyId,
    event_date: value.eventDate,
    description: value.description,
    amount: value.amount,
    transaction_kind: value.transactionKind,
    normalized_category: value.normalizedCategory,
    payee: value.payee,
    check_number: value.checkNumber,
    bank_account_id: value.bankAccountId,
    cleared: value.cleared,
    cleared_at: value.cleared ? new Date().toISOString() : null,
    tax_deductible: value.transactionKind === "expense",
    affects_noi: true,
    capitalized: false,
    source_system: "manual",
    metadata: {
      ...(value.memo ? { memo: value.memo } : {}),
      ...(value.tenantId ? { tenant_id: value.tenantId, charged_to_tenant: value.chargeTenant } : {}),
    },
    status: "active",
    is_deleted: false,
    created_by: userId,
    updated_by: userId,
  };
}

// POST /api/rental/transactions — create a Rentec-style ledger transaction.
// Body: { eventDate, description, amount, transactionKind, normalizedCategory,
//   payee?, checkNumber?, bankAccountId?, propertyId?, tenantId?, memo?,
//   cleared?, chargeTenant? }.
// Owner-scoped to the effective workspace owner; read-only members get a 403.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const { valid, errors, value } = validateTransaction(body);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    // The bank account must belong to this workspace — a foreign id 400s rather
    // than silently writing a dangling reference.
    if (value.bankAccountId) {
      const { data: accounts, error: accountError } = await authenticated.supabaseClient
        .from("financial_accounts")
        .select("id")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", value.bankAccountId)
        .limit(1);
      if (accountError) throw accountError;
      if (!accounts || accounts.length === 0) {
        return NextResponse.json({ error: "The selected bank account was not found." }, { status: 400 });
      }
    }

    const { data, error } = await authenticated.supabaseClient
      .from("financial_events")
      .insert(toRow({ ownerId: authenticated.effectiveOwnerId, userId: authenticated.user.id, value }))
      .select("id, event_date, description, amount, transaction_kind, normalized_category, payee, check_number, bank_account_id, cleared, cleared_at, property_id")
      .limit(1);
    if (error) throw error;

    return NextResponse.json({ success: true, event: (data || [])[0] || null });
  } catch (error) {
    console.error("Transaction create error", error);
    return NextResponse.json({ error: "Unable to save the transaction." }, { status: 500 });
  }
}

// GET /api/rental/transactions?eventId= — full editable field set for one owned
// manual event, for edit prefill. Imported events are not editable here.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient
      .from("financial_events")
      .select("id, event_date, description, amount, transaction_kind, normalized_category, payee, check_number, bank_account_id, property_id, cleared, cleared_at, metadata")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", eventId)
      .eq("source_system", "manual")
      .eq("is_deleted", false)
      .limit(1);
    if (error) throw error;
    const event = (data || [])[0];
    if (!event) return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        transactionKind: event.transaction_kind,
        eventDate: event.event_date,
        amount: Number(event.amount),
        description: event.description,
        payee: event.payee,
        checkNumber: event.check_number,
        bankAccountId: event.bank_account_id,
        propertyId: event.property_id,
        tenantId: event.metadata?.tenant_id || "",
        normalizedCategory: event.normalized_category,
        memo: event.metadata?.memo || "",
        cleared: event.cleared === true,
        chargeTenant: event.metadata?.charged_to_tenant === true,
      },
    });
  } catch (error) {
    console.error("Transaction fetch error", error);
    return NextResponse.json({ error: "Unable to load the transaction." }, { status: 500 });
  }
}

async function ownManualEvent(supabaseClient, effectiveOwnerId, eventId) {
  const { data, error } = await supabaseClient
    .from("financial_events")
    .select("id, cleared, cleared_at")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", eventId)
    .eq("source_system", "manual")
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

// PATCH /api/rental/transactions — edit a manual transaction.
// Body: { eventId, ...same full field set as POST }. The form always sends the
// complete field set, so validation is identical to create. Imported events
// (source_system != manual) cannot be edited here.
export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const eventId = String(body.eventId || "").trim();
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });

    const { valid, errors, value } = validateTransaction(body);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    const existing = await ownManualEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId);
    if (!existing) return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });

    if (value.bankAccountId) {
      const { data: accounts, error: accountError } = await authenticated.supabaseClient
        .from("financial_accounts")
        .select("id")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", value.bankAccountId)
        .limit(1);
      if (accountError) throw accountError;
      if (!accounts || accounts.length === 0) {
        return NextResponse.json({ error: "The selected bank account was not found." }, { status: 400 });
      }
    }

    // cleared_at is sticky: once a transaction clears, the original timestamp
    // is kept; un-clearing drops it.
    const clearedAt = value.cleared ? (existing.cleared_at || new Date().toISOString()) : null;
    const { data, error } = await authenticated.supabaseClient
      .from("financial_events")
      .update({
        property_id: value.propertyId,
        event_date: value.eventDate,
        description: value.description,
        amount: value.amount,
        transaction_kind: value.transactionKind,
        normalized_category: value.normalizedCategory,
        payee: value.payee,
        check_number: value.checkNumber,
        bank_account_id: value.bankAccountId,
        cleared: value.cleared,
        cleared_at: clearedAt,
        metadata: {
          ...(value.memo ? { memo: value.memo } : {}),
          ...(value.tenantId ? { tenant_id: value.tenantId, charged_to_tenant: value.chargeTenant } : {}),
        },
        updated_by: authenticated.user.id,
      })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", eventId)
      .select("id, event_date, description, amount, transaction_kind, normalized_category, payee, check_number, bank_account_id, cleared, cleared_at, property_id")
      .limit(1);
    if (error) throw error;

    return NextResponse.json({ success: true, event: (data || [])[0] || null });
  } catch (error) {
    console.error("Transaction update error", error);
    return NextResponse.json({ error: "Unable to save the transaction." }, { status: 500 });
  }
}

// DELETE /api/rental/transactions?eventId= — soft-delete a manual transaction.
// Sets is_deleted / deleted_at / status='deleted' per the table's check
// constraint. Nothing is ever hard-removed; attachments and splits stay for
// the audit trail.
export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });

    const existing = await ownManualEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId);
    if (!existing) return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });

    const { error } = await authenticated.supabaseClient
      .from("financial_events")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        status: "deleted",
        updated_by: authenticated.user.id,
      })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", eventId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transaction delete error", error);
    return NextResponse.json({ error: "Unable to delete the transaction." }, { status: 500 });
  }
}
