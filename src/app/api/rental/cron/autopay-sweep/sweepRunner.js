import { executeAutopayAttempt } from "@/application/rental/executeAutopayAttempt";
import { AUTOPAY_COLLECTIBLE_CHARGE_TYPES } from "@/application/rental/tenantCharges";
import { reconcileMissingStripeSettlements } from "../settlement-reconciliation/route.js";

export const RENTAL_AUTOPAY_SWEEP_NAME = "rental-autopay";
// A claim older than this with no terminal state is treated as a dead
// runner and becomes reclaimable. At current portfolio scale a sweep takes
// seconds; 30 minutes is deliberately generous.
export const SWEEP_CLAIM_STALE_MINUTES = 30;

// Durable sweep-execution evidence (table rental_sweep_runs, append-only
// per-run audit log) and the atomic daily claim (table rental_sweep_claims,
// one row per (sweep_name, sweep_date) enforced by PRIMARY KEY).
//
// Background: GitHub Actions documents that scheduled runs can be delayed
// under load and dropped entirely. The 02:00 CDT autopay sweep silently
// missed 2026-10-05 and 2026-10-06 with no workflow run object created.
// The recovery watchdog checks durable state here -- not the Actions API.
//
// Both the scheduled primary sweep and the watchdog MUST acquire the claim
// before running. The claim insert is atomic, so two simultaneous callers
// (primary vs watchdog, or two watchdog calls) cannot both own the sweep --
// no check-then-act race. Downstream payment idempotency remains as
// defense-in-depth, never the only defense.
//
// Marker/claim writes for the evidence log are best-effort: they must never
// break the money-moving sweep itself (e.g. if a migration has not been
// applied yet). A missing evidence row only risks a duplicate sweep, and
// the sweep is idempotent (executeAutopayAttempt no-ops on
// already-attempted pairs). Claim acquisition itself is NOT best-effort:
// if we cannot reach the claim table we cannot safely run.

function isUniqueViolation(error) {
  return error?.code === "23505";
}

// Acquire today's exclusive right to run the sweep.
// Returns { acquired: true, reclaimed } on success, or
// { acquired: false, reason, owner } when someone else owns it.
export async function acquireSweepClaim(db, sweepName, sweepDate, triggeredBy, staleMinutes = SWEEP_CLAIM_STALE_MINUTES) {
  const nowIso = new Date().toISOString();
  // Fast path: atomic insert. The PRIMARY KEY guarantees mutual exclusion.
  const { error: insertError } = await db.from("rental_sweep_claims").insert({
    sweep_name: sweepName,
    sweep_date: sweepDate,
    status: "claimed",
    claimed_by: triggeredBy,
    claimed_at: nowIso,
    attempts: 1,
  });
  if (!insertError) return { acquired: true, reclaimed: false };
  if (!isUniqueViolation(insertError)) throw insertError;

  // A claim row already exists for today. Read it and decide.
  const { data: existing, error: selectError } = await db.from("rental_sweep_claims")
    .select("status, claimed_by, claimed_at, attempts")
    .eq("sweep_name", sweepName)
    .eq("sweep_date", sweepDate)
    .single();
  if (selectError) throw selectError;

  // Terminal success: nobody runs again today.
  if (existing.status === "completed") return { acquired: false, reason: "already-completed" };

  // Retry/reclaim semantics: a failed run is explicitly retryable; a claim
  // with no terminal state older than the stale threshold is a dead runner.
  const staleCutoff = Date.now() - staleMinutes * 60 * 1000;
  const isStale = new Date(existing.claimed_at).getTime() < staleCutoff;
  const reclaimable = existing.status === "failed" || isStale;
  if (!reclaimable) return { acquired: false, reason: "in-progress", owner: existing.claimed_by };

  // Atomic compare-and-swap: only win if the row is still exactly as we saw
  // it. The predicate includes the observed claimed_at (the claim token):
  // a winning reclaim always sets claimed_at=now(), so a simultaneous
  // reclaimer's predicate on the OLD claimed_at no longer matches and it
  // loses (0 rows updated) instead of both proceeding. Predicating on
  // status alone is NOT sufficient -- reclaiming a stale 'claimed' row
  // writes status='claimed' right back, so a second racer's status
  // predicate would still match after the first racer won.
  const { data: updated, error: reclaimError } = await db.from("rental_sweep_claims")
    .update({
      status: "claimed",
      claimed_by: triggeredBy,
      claimed_at: nowIso,
      updated_at: nowIso,
      attempts: (existing.attempts || 1) + 1,
    })
    .eq("sweep_name", sweepName)
    .eq("sweep_date", sweepDate)
    .eq("status", existing.status)
    .eq("claimed_at", existing.claimed_at)
    .select("sweep_name");
  if (reclaimError) throw reclaimError;
  if (!updated || updated.length === 0) return { acquired: false, reason: "lost-reclaim-race" };
  return { acquired: true, reclaimed: true, previousStatus: existing.status };
}

// Only the current claim owner may release the claim. If our claim was
// reclaimed out from under us mid-run (dead-runner timeout), our release
// matches zero rows and we leave the new owner's claim alone.
export async function releaseSweepClaim(db, sweepName, sweepDate, status, claimedBy) {
  const { data, error } = await db.from("rental_sweep_claims")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("sweep_name", sweepName)
    .eq("sweep_date", sweepDate)
    .eq("claimed_by", claimedBy)
    .select("sweep_name");
  if (error) throw error;
  return { released: (data || []).length > 0 };
}

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

// Runs the full rental autopay sweep under the atomic daily claim.
// triggeredBy: 'schedule' | 'watchdog' | 'manual' (recovery provenance).
// When the claim is already owned, returns a no-op result
// { success: true, skipped: true, claimReason, owner } instead of running.
export async function runRentalAutopaySweep({ db, provider, today, triggeredBy }) {
  const claim = await acquireSweepClaim(db, RENTAL_AUTOPAY_SWEEP_NAME, today, triggeredBy);
  if (!claim.acquired) {
    return { success: true, skipped: true, claimReason: claim.reason, owner: claim.owner ?? null };
  }
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
    const release = await releaseSweepClaim(db, RENTAL_AUTOPAY_SWEEP_NAME, today, "completed", triggeredBy);
    if (!release.released) {
      // Our claim was reclaimed mid-run (we ran long past the stale
      // threshold). The money work is done; leave the new owner's claim
      // alone and say so loudly.
      console.error("Sweep claim was reclaimed mid-run; not overwriting the new owner's claim");
    }
    await recordSweepFinished(db, runId, "completed", result);
    return result;
  } catch (error) {
    // Release the claim as failed so an explicit retry can reclaim it; the
    // error still propagates so the caller (and the Actions workflow) sees
    // the failure instead of silently swallowing a money-moving error.
    try {
      await releaseSweepClaim(db, RENTAL_AUTOPAY_SWEEP_NAME, today, "failed", triggeredBy);
    } catch (claimError) {
      console.error("Sweep claim release (failed) errored", claimError);
    }
    await recordSweepFinished(db, runId, "failed", { error: error?.message || String(error) });
    throw error;
  }
}
