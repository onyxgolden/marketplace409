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
