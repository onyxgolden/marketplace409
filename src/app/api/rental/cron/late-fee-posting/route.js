import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import {
  LATE_FEE_ELIGIBLE_CHARGE_TYPES, LATE_FEE_ELIGIBLE_STATUSES,
  resolveLateFeePolicy, isChargeLateFeeEligible, buildLateFeeChargeRow,
} from "@/domains/late-fee/lateFeeAutoPost";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
//
// Automatic late-fee posting (Rentec parity R1). For every owner whose billing
// is enabled AND whose late-fee auto-post toggle is on, posts one late_fee
// charge per rent/proration charge that is unpaid past its grace period.
//
// Safety fences (mirroring the rent-due-reminders cron):
// - active lease + FORGE-collected schedule only — ad-hoc charges and
//   externally-collected schedules never receive automatic fees;
// - never compounds: existing late_fee charges are ineligible;
// - idempotent: the (owner_id, source_key) unique constraint plus
//   `latefee:auto:<chargeId>` keys mean a re-run can never double-post;
// - a voided auto-posted fee is treated as forgiven and is not re-posted
//   (the source key already exists).
//
// ?dryRun=true evaluates and reports without writing anything.

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function mapChargeRow(row) {
  return {
    id: row.id, leaseId: row.lease_id, scheduleId: row.schedule_id,
    chargeType: row.charge_type, amountCents: Number(row.amount_cents),
    paidAmountCents: Number(row.paid_amount_cents || 0), dueDate: row.due_date,
    status: row.status, currencyCode: row.currency_code, period: row.period,
  };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  try {
    const db = createRentalWebhookClient();
    const asOfDate = todayISODate();

    // Owner-level master gates: billing enabled AND auto-post enabled. An
    // owner who never configured late fees contributes zero candidates.
    const { data: settingsRows, error: settingsError } = await db.from("rental_billing_settings")
      .select("owner_id, late_fee_auto_post, late_fee_grace_days, late_fee_calculation_type, late_fee_fixed_amount_cents, late_fee_percentage_basis_points, late_fee_maximum_amount_cents")
      .eq("billing_enabled", true).eq("late_fee_auto_post", true);
    if (settingsError) throw settingsError;
    const settingsByOwner = new Map();
    for (const row of settingsRows || []) settingsByOwner.set(row.owner_id, row);
    if (settingsByOwner.size === 0) {
      return NextResponse.json({ success: true, dryRun, asOfDate, evaluated: 0, posted: 0, wouldPost: 0, skipped: 0, failed: 0 });
    }
    const ownerIds = [...settingsByOwner.keys()];

    // Per-tenant overrides for these owners.
    const { data: overrideRows, error: overrideError } = await db.from("rental_late_fee_tenant_overrides")
      .select("owner_id, tenant_id, exempt, grace_days, calculation_type, fixed_amount_cents, percentage_basis_points, maximum_amount_cents")
      .in("owner_id", ownerIds);
    if (overrideError) throw overrideError;
    const overrideByOwnerTenant = new Map();
    for (const row of overrideRows || []) overrideByOwnerTenant.set(`${row.owner_id}|${row.tenant_id}`, row);

    // Candidate charges: unpaid rent/proration for these owners.
    const { data: chargeRows, error: chargeError } = await db.from("rent_charges")
      .select("owner_id, id, lease_id, schedule_id, charge_type, amount_cents, paid_amount_cents, due_date, status, currency_code, period")
      .in("owner_id", ownerIds)
      .in("charge_type", LATE_FEE_ELIGIBLE_CHARGE_TYPES)
      .in("status", LATE_FEE_ELIGIBLE_STATUSES);
    if (chargeError) throw chargeError;

    // Lease + schedule gates: active lease, FORGE-collected schedule.
    const leaseIds = [...new Set((chargeRows || []).map((charge) => charge.lease_id))];
    const scheduleIds = [...new Set((chargeRows || []).map((charge) => charge.schedule_id).filter(Boolean))];
    const [{ data: leases, error: leaseError }, { data: schedules, error: scheduleError }] = await Promise.all([
      leaseIds.length
        ? db.from("rental_leases").select("id, status").in("id", leaseIds)
        : Promise.resolve({ data: [], error: null }),
      scheduleIds.length
        ? db.from("rent_schedules").select("id, collection_mode").in("id", scheduleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (leaseError) throw leaseError;
    if (scheduleError) throw scheduleError;
    const activeLeaseIds = new Set((leases || []).filter((lease) => lease.status === "active").map((lease) => lease.id));
    const forgeScheduleIds = new Set((schedules || []).filter((schedule) => schedule.collection_mode === "forge").map((schedule) => schedule.id));
    const eligible = (chargeRows || []).filter((charge) =>
      activeLeaseIds.has(charge.lease_id) && charge.schedule_id && forgeScheduleIds.has(charge.schedule_id));
    if (eligible.length === 0) {
      return NextResponse.json({ success: true, dryRun, asOfDate, evaluated: 0, posted: 0, wouldPost: 0, skipped: 0, failed: 0 });
    }

    // Tenant memberships for per-lease override resolution.
    const eligibleLeaseIds = [...new Set(eligible.map((charge) => charge.lease_id))];
    const { data: membershipRows, error: membershipError } = await db.from("rental_lease_tenants")
      .select("lease_id, tenant_id, occupancy_role").in("lease_id", eligibleLeaseIds);
    if (membershipError) throw membershipError;
    const membershipsByLease = new Map();
    for (const row of membershipRows || []) {
      if (!membershipsByLease.has(row.lease_id)) membershipsByLease.set(row.lease_id, []);
      membershipsByLease.get(row.lease_id).push(row);
    }

    // Per lease: exempt if ANY tenant is exempt (safe direction — an exemption
    // promise is never overridden by a co-tenant's absence of one); otherwise
    // the primary tenant's override wins, falling back to the first override
    // by tenant id so multi-tenant leases stay deterministic.
    function policyForCharge(charge) {
      const settings = settingsByOwner.get(charge.owner_id);
      const memberships = membershipsByLease.get(charge.lease_id) || [];
      const overrides = memberships
        .map((membership) => overrideByOwnerTenant.get(`${charge.owner_id}|${membership.tenant_id}`))
        .filter(Boolean);
      if (overrides.some((override) => override.exempt === true)) return { exempt: true };
      const primary = memberships.find((membership) => membership.occupancy_role === "primary");
      const chosen = (primary && overrideByOwnerTenant.get(`${charge.owner_id}|${primary.tenant_id}`))
        || [...overrides].sort((a, b) => String(a.tenant_id).localeCompare(String(b.tenant_id)))[0]
        || null;
      return resolveLateFeePolicy({ settings, override: chosen });
    }

    let posted = 0, wouldPost = 0, skipped = 0, failed = 0;
    for (const chargeRow of eligible) {
      try {
        const policy = policyForCharge(chargeRow);
        const charge = mapChargeRow(chargeRow);
        if (!isChargeLateFeeEligible({ charge, policy, asOfDate })) { skipped += 1; continue; }
        if (dryRun) { wouldPost += 1; continue; }
        const feeRow = { ...buildLateFeeChargeRow({ ownerId: chargeRow.owner_id, charge, policy, asOfDate }) };
        // The upsert is the atomic idempotency guard: a racing or repeated
        // run inserts zero rows for an already-posted fee.
        const { data: inserted, error: upsertError } = await db.from("rent_charges")
          .upsert(feeRow, { onConflict: "owner_id,source_key", ignoreDuplicates: true })
          .select("id");
        if (upsertError) throw upsertError;
        if (inserted && inserted.length === 1) posted += 1;
        else skipped += 1;
      } catch (chargeErrorInner) {
        failed += 1;
        console.error("Late-fee auto-post failed for charge", chargeRow.id, chargeErrorInner);
      }
    }
    return NextResponse.json({ success: true, dryRun, asOfDate, evaluated: eligible.length, posted, wouldPost, skipped, failed });
  } catch (error) {
    console.error("Late-fee auto-post cron error", error);
    return NextResponse.json({ error: "Unable to post late fees." }, { status: 500 });
  }
}
