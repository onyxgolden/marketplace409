// Tenant charges — the shared charge-creation service for both entry points:
// Post Expense → "Charge tenant" and the standalone "Add charge" on the tenant
// ledger. Ad-hoc charges (damage / fee / utility / other) live on rent_charges
// with schedule_id NULL (migration 20260926160000); rent billing is untouched.
//
// Money-flow honesty (ChatGPT review 2026-09-26, keep this invariant):
// - An expense + charge is an EXPENSE and a RECEIVABLE, not two expenses. When
//   the tenant later pays the charge, that payment is REIMBURSEMENT INCOME — the
//   reporting layer must distinguish it from the original property expense or
//   income/expense reports will double-count.
// - Voluntary payment ≠ autopay. Tenants may manually pay any valid charge type
//   through the portal. Autopay (sweep + executeAutopayAttempt) and reminders
//   operate on AUTOPAY_COLLECTIBLE_CHARGE_TYPES only — new types are excluded
//   from automatic collection by default.
// - Reversal = void (void_rental_rent_charge RPC), never delete. Voiding the
//   charge does NOT delete the owner's expense. A charge with paid_amount_cents
//   > 0 cannot be voided — resolve through refunds/credits first.

export const TENANT_CHARGE_TYPES = Object.freeze(["damage", "fee", "utility", "other"]);

export const TENANT_CHARGE_LABELS = Object.freeze({
  damage: "Damage",
  fee: "Fee",
  utility: "Utility reimbursement",
  other: "Other charge",
});

// Explicit allowlist for AUTOMATIC collection. Anything not on this list is
// never auto-collected (autopay sweep, autopay execute, reminders). Allowlist,
// not denylist: any future charge type is excluded by default until explicitly
// authorized. Tenants may still VOLUNTARILY pay any valid charge type through
// the portal — do not reuse this list to gate manual payment.
export const AUTOPAY_COLLECTIBLE_CHARGE_TYPES = Object.freeze(["rent", "proration", "late_fee"]);

export const TENANT_CHARGE_DUE_DAYS_DEFAULT = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (value) => typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
const text = (value) => (typeof value === "string" ? value.trim() : "");

// Owner-set due date, defaulting to 15 calendar days after the charge date.
export function defaultTenantChargeDueDate(chargeDateISO) {
  if (!isValidDate(chargeDateISO)) return null;
  const due = new Date(`${chargeDateISO}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + TENANT_CHARGE_DUE_DAYS_DEFAULT);
  return due.toISOString().slice(0, 10);
}

export function isAutopayCollectibleChargeType(chargeType) {
  return AUTOPAY_COLLECTIBLE_CHARGE_TYPES.includes(chargeType);
}

// Pure validation for a tenant charge. leaseId is mandatory; schedule is never
// accepted here — ad-hoc charges are schedule-less by definition. dueDate
// defaults to chargeDate + 15 days when omitted.
export function validateTenantChargeInput(input) {
  const errors = [];
  const leaseId = text(input?.leaseId);
  const chargeType = text(input?.chargeType);
  const description = text(input?.description);
  const chargeDate = text(input?.chargeDate);
  if (!leaseId) errors.push("A lease is required for the charge.");
  if (!TENANT_CHARGE_TYPES.includes(chargeType)) errors.push("Charge type must be damage, fee, utility, or other.");
  const amountCents = Number(input?.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) errors.push("Charge amount must be a positive number of cents.");
  if (!description) errors.push("A description is required for the charge.");
  if (chargeDate && !isValidDate(chargeDate)) errors.push("Charge date must be a valid date.");
  const dueDate = text(input?.dueDate) || (chargeDate && isValidDate(chargeDate) ? defaultTenantChargeDueDate(chargeDate) : "");
  if (!isValidDate(dueDate)) errors.push("A valid due date is required.");
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: { leaseId, chargeType, amountCents, description, chargeDate: chargeDate || null, dueDate },
  };
}

// Standalone charge (no expense): inserts the schedule-less rent_charges row
// directly. The caller verifies workspace ownership of the lease; RLS enforces
// it at the database. source_key is unique per charge so retries never double
// the tenant's balance.
export async function createTenantCharge(db, { ownerId, leaseId, chargeType, amountCents, description, dueDate, chargeDate, sourceKey }) {
  const check = validateTenantChargeInput({ leaseId, chargeType, amountCents, description, dueDate, chargeDate });
  if (!check.valid) throw new Error(check.errors.join(" "));
  const value = check.value;

  const { data: lease, error: leaseError } = await db.from("rental_leases")
    .select("id, currency_code").eq("owner_id", ownerId).eq("id", value.leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) throw new Error("Lease was not found.");

  const id = `rent_charge_tenant_${crypto.randomUUID().replaceAll("-", "")}`;
  const row = {
    owner_id: ownerId,
    id,
    lease_id: value.leaseId,
    schedule_id: null,
    period: (value.chargeDate || value.dueDate).slice(0, 7),
    due_date: value.dueDate,
    amount_cents: value.amountCents,
    paid_amount_cents: 0,
    currency_code: lease.currency_code || "USD",
    status: "due",
    source_key: sourceKey || `tenantcharge:standalone:${id}`,
    notes: value.description,
    charge_type: value.chargeType,
  };
  const { data, error } = await db.from("rent_charges").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

// Expense-linked charge: the financial_events expense row and the rent_charges
// row are created atomically by the create_expense_with_tenant_charge RPC — any
// failure rolls back both. `event` carries the transaction-form fields
// (eventDate, description, amount, normalizedCategory, payee, checkNumber,
// bankAccountId, propertyId, tenantId, memo, cleared); `charge` carries the
// validated charge fields (leaseId, chargeType, amountCents, description,
// dueDate, chargeDate).
export async function createExpenseWithTenantCharge(db, { ownerId, event, charge }) {
  if (!ownerId || typeof ownerId !== "string" || !ownerId.trim()) throw new Error("Owner id is required.");
  const amount = Number(event?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Expense amount must be positive.");
  const check = validateTenantChargeInput(charge);
  if (!check.valid) throw new Error(check.errors.join(" "));
  const value = check.value;

  const { data, error } = await db.rpc("create_expense_with_tenant_charge", {
    p_owner_id: ownerId.trim(),
    p_event: {
      eventDate: event.eventDate,
      description: event.description,
      amount,
      normalizedCategory: event.normalizedCategory || null,
      payee: event.payee || null,
      checkNumber: event.checkNumber || null,
      bankAccountId: event.bankAccountId || null,
      propertyId: event.propertyId || null,
      tenantId: event.tenantId || null,
      memo: event.memo || null,
      cleared: event.cleared === true,
      transactionKind: "expense",
    },
    p_charge: {
      leaseId: value.leaseId,
      chargeType: value.chargeType,
      amountCents: value.amountCents,
      description: value.description,
      dueDate: value.dueDate,
      chargeDate: value.chargeDate || event.eventDate,
    },
  });
  if (error) throw error;
  return data;
}
