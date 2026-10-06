import { executeAutopayAttempt } from "@/application/rental/executeAutopayAttempt";
import { AUTOPAY_COLLECTIBLE_CHARGE_TYPES } from "@/application/rental/tenantCharges";
import { reconcileMissingStripeSettlements } from "../settlement-reconciliation/route.js";

export const RENTAL_AUTOPAY_SWEEP_NAME = "rental-autopay";

// Durable sweep-execution evidence (table rental_sweep_runs).
//
// Background: GitHub Actions documents that scheduled runs can be delayed
// under load and dropped entirely. The 02:00 CDT autopay sweep silently
// missed 2026-10-05 and 2026-10-06 with no workflow run object created.
// The recovery watchdog checks THIS table -- not the Actions API -- to
// decide whether today's sweep already ran.
//
// Marker writes are best-effort: they must never break the money-moving
// sweep itself (e.g. if the migration has not been applied yet). A missing
// marker only risks a duplicate sweep, and the sweep is idempotent
// (executeAutopayAttempt no-ops on already-attempted pairs).
async function recordSweepStarted(db, sweepName, sweepDate, triggeredBy) {
  try {
    const { data, error } = await db.from("rental_sweep_runs")
      .insert({ sweep_name: sweepName, sweep_date: sweepDate, triggered_by: triggeredBy, status: "started" })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (markerError) {
    console.error("Sweep evidence marker (started) failed; continuing sweep anyway", markerError);
    return null;
  }
}

async function recordSweepFinished(db, runId, status, result = {}) {
  if (!runId) return;
  try {
    const { error } = await db.from("rental_sweep_runs").update({
      status,
      completed_at: new Date().toISOString(),
      candidates: result.candidates ?? null,
      succeeded: result.succeeded ?? null,
      failed: result.failed ?? null,
      skipped: result.skipped ?? null,
      error: result.error ?? null,
    }).eq("id", runId);
    if (error) throw error;
  } catch (markerError) {
    console.error("Sweep evidence marker (finished) failed", markerError);
  }
}

// The watchdog's evidence check: has this sweep completed today?
export async function sweepCompletedToday(db, sweepName, sweepDate) {
  const { data, error } = await db.from("rental_sweep_runs")
    .select("id")
    .eq("sweep_name", sweepName)
    .eq("sweep_date", sweepDate)
    .eq("status", "completed")
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// Runs the full rental autopay sweep and records durable evidence.
// triggeredBy: 'schedule' | 'watchdog' | 'manual' (recovery provenance).
export async function runRentalAutopaySweep({ db, provider, today, triggeredBy }) {
  const runId = await recordSweepStarted(db, RENTAL_AUTOPAY_SWEEP_NAME, today, triggeredBy);
  try {
    // Scoped by provider_mode: a preserved sandbox enrollment (even one still marked 'active'
    // from test-key usage) must never be picked up by a live-mode sweep, and vice versa — a
    // landlord/tenant must set up autopay again for live payments rather than it silently
    // carrying over.
    const [{ data: enrollments, error: enrollmentError }, { data: charges, error: chargeError }] = await Promise.all([
      db.from("rental_autopay_enrollments").select("id, owner_id, lease_id").eq("status", "active").eq("provider_mode", provider.mode),
      // Automatic collection is fenced to rent/proration/late_fee: ad-hoc charge
      // types (damage, fee, utility, other) are payable voluntarily through
      // the tenant portal but never swept by autopay.
      db.from("rent_charges").select("id, owner_id, lease_id, charge_type")
        .in("status", ["due", "partially_paid", "overdue"]).in("charge_type", AUTOPAY_COLLECTIBLE_CHARGE_TYPES)
        .lte("due_date", today),
    ]);
    if (enrollmentError) throw enrollmentError;
    if (chargeError) throw chargeError;

    const chargesByOwnerLease = new Map();
    for (const charge of charges || []) {
      const key = `${charge.owner_id}:${charge.lease_id}`;
      if (!chargesByOwnerLease.has(key)) chargesByOwnerLease.set(key, []);
      chargesByOwnerLease.get(key).push(charge);
    }
    const pairs = [];
    for (const enrollment of enrollments || []) {
      for (const charge of chargesByOwnerLease.get(`${enrollment.owner_id}:${enrollment.lease_id}`) || [])
        pairs.push({ enrollmentId: enrollment.id, chargeId: charge.id });
    }

    let succeeded = 0, failed = 0, skipped = 0;
    for (const pair of pairs) {
      try {
        const result = await executeAutopayAttempt(db, pair.enrollmentId, pair.chargeId);
        if (result.body?.skipped) skipped += 1;
        else if (result.httpStatus === 200) succeeded += 1; else failed += 1;
      } catch (attemptError) {
        failed += 1;
        console.error("Autopay sweep attempt failed", pair, attemptError);
      }
    }
    const settlements = await reconcileMissingStripeSettlements(db, provider);
    const result = { success: true, candidates: pairs.length, succeeded, failed, skipped, settlements };
    await recordSweepFinished(db, runId, "completed", result);
    return result;
  } catch (error) {
    await recordSweepFinished(db, runId, "failed", { error: error?.message || String(error) });
    throw error;
  }
}
