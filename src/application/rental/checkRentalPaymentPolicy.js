// Server-side payment-policy gate (Rentec parity R11).
//
// Used by both tenant-facing and owner-facing payment paths so the same rule
// is enforced in one place:
// - /api/rental/portal/payment-session (tenant portal, tenant-entered amount
//   path via the computed payment amount)
// - /api/rental record-offline-payment (owner manual recording)
//
// Stripe autopay is intentionally NOT gated here: autopay amounts are computed
// from the consented enrollment schedule, never tenant-entered. See
// src/domains/rental-payment/paymentPolicy.js for the documented decision.
//
// Money inputs: rent = the lease's active schedule amount (one month's rent,
// falling back to the lease's monthly_rent_cents); balance = the tenant's full
// outstanding balance across every lease they belong to (Rentec's "require
// balance" means the whole account, not one charge). Missing reference data
// fails open to any positive amount so a bad reference can never newly block
// a payment -- the domain function decides that, not this helper.
import { checkPaymentAmountAgainstPolicy, resolveEffectivePaymentPolicy, DEFAULT_PAYMENT_POLICY } from "@/domains/rental-payment/paymentPolicy";

const OPEN_CHARGE_STATUSES = ["scheduled", "due", "partially_paid", "overdue"];

export async function loadTenantPaymentContext(database, ownerId, tenantId) {
  const [{ data: settings }, { data: tenant }, { data: memberships }] = await Promise.all([
    database.from("rental_billing_settings").select("payment_policy").eq("owner_id", ownerId).maybeSingle(),
    tenantId
      ? database.from("rental_tenants").select("id, payment_policy").eq("owner_id", ownerId).eq("id", tenantId).maybeSingle()
      : { data: null, error: null },
    tenantId
      ? database.from("rental_lease_tenants").select("lease_id").eq("owner_id", ownerId).eq("tenant_id", tenantId)
      : { data: [], error: null },
  ]);
  const workspacePolicy = settings?.payment_policy || DEFAULT_PAYMENT_POLICY;
  const leaseIds = (memberships || []).map((row) => row.lease_id).filter(Boolean);
  return { workspacePolicy, tenantPolicy: tenant?.payment_policy ?? null, leaseIds };
}

// Returns { ok, message, effectivePolicy, isOverride, minimumCents,
// balanceCents, rentCents }. The route returns 422 with message when !ok.
export async function checkRentalPaymentPolicy(database, { ownerId, tenantId, amountCents }) {
  const { workspacePolicy, tenantPolicy, leaseIds } = await loadTenantPaymentContext(database, ownerId, tenantId);
  const effectivePolicy = resolveEffectivePaymentPolicy(tenantPolicy, workspacePolicy);

  let balanceCents = null;
  let rentCents = null;
  if (leaseIds.length) {
    const [{ data: charges }, { data: schedules }, { data: leases }] = await Promise.all([
      database.from("rent_charges").select("amount_cents, paid_amount_cents")
        .eq("owner_id", ownerId).in("lease_id", leaseIds).in("status", OPEN_CHARGE_STATUSES),
      database.from("rent_schedules").select("amount_cents, effective_start_date")
        .eq("owner_id", ownerId).in("lease_id", leaseIds).eq("status", "active")
        .order("effective_start_date", { ascending: false }),
      database.from("rental_leases").select("monthly_rent_cents")
        .eq("owner_id", ownerId).in("id", leaseIds),
    ]);
    balanceCents = (charges || []).reduce(
      (total, charge) => total + Math.max(0, Number(charge.amount_cents) - Number(charge.paid_amount_cents)), 0);
    rentCents = schedules?.[0]?.amount_cents != null ? Number(schedules[0].amount_cents)
      : Math.max(0, ...((leases || []).map((lease) => Number(lease.monthly_rent_cents) || 0)));
    if (!Number.isSafeInteger(rentCents) || rentCents <= 0) rentCents = null;
  }

  const verdict = checkPaymentAmountAgainstPolicy({ policy: effectivePolicy, amountCents, rentCents, balanceCents });
  return { ...verdict, effectivePolicy, isOverride: tenantPolicy != null, balanceCents, rentCents };
}
