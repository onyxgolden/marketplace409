import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { validateTransaction } from "@/application/rental/validateTransaction";
import { createExpenseWithTenantCharge, validateTenantChargeInput } from "@/application/rental/tenantCharges";

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
    display_as: value.displayAs,
    ref_number: value.refNumber,
    payee_mailing_address: value.payeeMailingAddress,
    assigned_to: value.assignedTo,
    is_recurring: value.isRecurring,
    recurrence_rule: value.recurrenceRule,
    depreciate: value.depreciate,
    tax_deductible: value.transactionKind === "expense",
    affects_noi: true,
    capitalized: false,
    source_system: "manual",
    metadata: {
      ...(value.memo ? { memo: value.memo } : {}),
      ...(value.tenantId ? { tenant_id: value.tenantId, charged_to_tenant: value.chargeTenant } : {}),
      ...(value.paymentMethod ? { payment_method: value.paymentMethod } : {}),
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
//   cleared?, chargeTenant?, tenantCharge? }.
//
// When chargeTenant is true (expense only), the expense AND the tenant's
// schedule-less rent charge are created atomically by the
// create_expense_with_tenant_charge RPC — never one without the other.
// tenantCharge: { leaseId, chargeType, amountCents?, description?, dueDate? }.
// amountCents defaults to the expense total; dueDate defaults to the event date
// + 15 days. Owner-scoped to the effective workspace owner; read-only members
// get a 403.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const { valid, errors, value } = validateTransaction(body);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    // Charge-tenant is expense-only: an income event can never create a charge.
    if (value.chargeTenant === true && value.transactionKind !== "expense") {
      return NextResponse.json({ error: "Only an expense can charge a tenant." }, { status: 400 });
    }

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

    // Atomic expense + tenant charge: one RPC, one transaction.
    if (value.chargeTenant === true) {
      const tenantCharge = body.tenantCharge && typeof body.tenantCharge === "object" ? body.tenantCharge : {};
      const expenseCents = Math.round(Number(value.amount) * 100);
      const chargeCheck = validateTenantChargeInput({
        leaseId: tenantCharge.leaseId,
        chargeType: tenantCharge.chargeType,
        amountCents: tenantCharge.amountCents ?? expenseCents,
        description: tenantCharge.description || value.description,
        dueDate: tenantCharge.dueDate,
        chargeDate: value.eventDate,
      });
      if (!chargeCheck.valid) return NextResponse.json({ error: chargeCheck.errors.join(" ") }, { status: 400 });
      try {
        const result = await createExpenseWithTenantCharge(authenticated.supabaseClient, {
          ownerId: authenticated.effectiveOwnerId,
          event: {
            eventDate: value.eventDate,
            description: value.description,
            amount: Number(value.amount),
            normalizedCategory: value.normalizedCategory,
            payee: value.payee,
            checkNumber: value.checkNumber,
            bankAccountId: value.bankAccountId,
            propertyId: value.propertyId,
            tenantId: value.tenantId,
            memo: value.memo,
            cleared: value.cleared,
            displayAs: value.displayAs,
            refNumber: value.refNumber,
            payeeMailingAddress: value.payeeMailingAddress,
            assignedTo: value.assignedTo,
            paymentMethod: value.paymentMethod,
            isRecurring: value.isRecurring,
            recurrenceRule: value.recurrenceRule,
            depreciate: value.depreciate,
          },
          charge: chargeCheck.value,
        });
        return NextResponse.json({
          success: true,
          event: { id: result.eventId, event_date: value.eventDate, description: value.description,
            amount: Number(value.amount), transaction_kind: "expense", property_id: value.propertyId },
          chargeId: result.chargeId,
        });
      } catch (chargeError) {
        console.error("Transaction with tenant charge error", chargeError);
        const message = chargeError?.message || "Unable to save the transaction and tenant charge.";
        return NextResponse.json({ error: message }, { status: /required|must be|was not found|positive/i.test(message) ? 400 : 500 });
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
      .select("id, event_date, description, amount, transaction_kind, normalized_category, payee, check_number, bank_account_id, property_id, cleared, cleared_at, display_as, ref_number, payee_mailing_address, assigned_to, is_recurring, recurrence_rule, depreciate, metadata")
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
        displayAs: event.display_as || "",
        refNumber: event.ref_number || "",
        payeeMailingAddress: event.payee_mailing_address || "",
        assignedTo: event.assigned_to || "",
        paymentMethod: event.metadata?.payment_method || "",
        isRecurring: event.is_recurring === true,
        recurrenceRule: event.recurrence_rule || "",
        depreciate: event.depreciate === true,
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
    .select("id, cleared, cleared_at, event_date, description, amount, transaction_kind, normalized_category, payee, check_number, bank_account_id, property_id, display_as, ref_number, payee_mailing_address, assigned_to, is_recurring, recurrence_rule, depreciate, metadata")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", eventId)
    .eq("source_system", "manual")
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

// Column-backed editable fields, for the edit-history diff: [db column, validated value key].
// metadata-backed fields are listed separately below.
// Note on recurrence_rule: the column is text (not JSONB) and validation
// always normalizes it to a trimmed string or null, so the String()
// normalization below is lossless for it — no structured comparison needed.
const DIFFABLE_COLUMNS = [
  ["event_date", "eventDate"],
  ["description", "description"],
  ["amount", "amount"],
  ["transaction_kind", "transactionKind"],
  ["normalized_category", "normalizedCategory"],
  ["payee", "payee"],
  ["check_number", "checkNumber"],
  ["bank_account_id", "bankAccountId"],
  ["property_id", "propertyId"],
  ["cleared", "cleared"],
  ["display_as", "displayAs"],
  ["ref_number", "refNumber"],
  ["payee_mailing_address", "payeeMailingAddress"],
  ["assigned_to", "assignedTo"],
  ["is_recurring", "isRecurring"],
  ["recurrence_rule", "recurrenceRule"],
  ["depreciate", "depreciate"],
];
const DIFFABLE_METADATA = [
  ["memo", "memo"],
  ["tenant_id", "tenantId"],
  ["payment_method", "paymentMethod"],
];

const normalizeDiffValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return String(value);
};

// Build the { field: { from, to } } diff between the stored row and the new
// validated value. Empty and null are treated as equal so clearing a field
// that was already empty is not recorded as a change.
function diffEditableFields(before, value) {
  const changes = {};
  const beforeMetadata = (before && before.metadata) || {};
  for (const [column, key] of DIFFABLE_COLUMNS) {
    let from = normalizeDiffValue(before ? before[column] : null);
    let to = normalizeDiffValue(value[key]);
    if (key === "amount") {
      // Numeric columns may come back from the database as strings
      // ("450.00"); compare as numbers so an unchanged amount is not
      // recorded as a change.
      const fromNum = from === null ? null : Number(from);
      const toNum = to === null ? null : Number(to);
      if (Number.isFinite(fromNum)) from = fromNum;
      if (Number.isFinite(toNum)) to = toNum;
    }
    if (typeof from === "boolean" || typeof to === "boolean") {
      // Nullable booleans: null and false both mean "no" (e.g. cleared).
      if (from === null) from = false;
      if (to === null) to = false;
    }
    if (from !== to) changes[key] = { from, to };
  }
  for (const [metaKey, key] of DIFFABLE_METADATA) {
    const from = normalizeDiffValue(beforeMetadata[metaKey]);
    const to = normalizeDiffValue(value[key]);
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
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

    // A tenant charge is created once, atomically, at posting time. Editing the
    // transaction must not silently rewrite or orphan it — void the charge
    // through Rent & payments instead.
    if (value.chargeTenant === true) {
      return NextResponse.json({ error: "A tenant charge cannot be changed by editing the transaction. Void the charge in Rent & payments instead." }, { status: 400 });
    }

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
    const changes = diffEditableFields(existing, value);

    // The edit and its audit row are written by one RPC in a single database
    // transaction: if the history insert fails, the edit rolls back with it.
    // A successful edit therefore always carries its audit record — the
    // failure surfaces here as a 500 instead of being swallowed.
    const { data: updated, error: rpcError } = await authenticated.supabaseClient.rpc(
      "update_transaction_with_history",
      {
        p_owner_id: authenticated.effectiveOwnerId,
        p_event_id: eventId,
        p_event: {
          propertyId: value.propertyId,
          eventDate: value.eventDate,
          description: value.description,
          amount: value.amount,
          transactionKind: value.transactionKind,
          normalizedCategory: value.normalizedCategory,
          payee: value.payee,
          checkNumber: value.checkNumber,
          bankAccountId: value.bankAccountId,
          cleared: value.cleared,
          displayAs: value.displayAs,
          refNumber: value.refNumber,
          payeeMailingAddress: value.payeeMailingAddress,
          assignedTo: value.assignedTo,
          isRecurring: value.isRecurring,
          recurrenceRule: value.recurrenceRule,
          depreciate: value.depreciate,
          memo: value.memo,
          tenantId: value.tenantId,
          chargeTenant: value.chargeTenant,
          paymentMethod: value.paymentMethod,
        },
        p_changes: changes,
        p_edited_by: authenticated.user.id,
        p_cleared_at: clearedAt,
      }
    );
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, event: updated });
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
