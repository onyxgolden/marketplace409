import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { executeAutopayAttempt } from "@/application/rental/executeAutopayAttempt";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { reconcileMissingStripeSettlements } from "../settlement-reconciliation/route.js";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
// Safe to run more than once a day: executeAutopayAttempt no-ops on an
// (enrollment, charge) pair that already has an attempt recorded.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: enrollments, error: enrollmentError }, { data: charges, error: chargeError }] = await Promise.all([
      db.from("rental_autopay_enrollments").select("id, owner_id, lease_id").eq("status", "active"),
      db.from("rent_charges").select("id, owner_id, lease_id").in("status", ["due", "partially_paid", "overdue"]).lte("due_date", today),
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

    let succeeded = 0, failed = 0;
    for (const pair of pairs) {
      try {
        const result = await executeAutopayAttempt(db, pair.enrollmentId, pair.chargeId);
        if (result.httpStatus === 200) succeeded += 1; else failed += 1;
      } catch (attemptError) {
        failed += 1;
        console.error("Autopay sweep attempt failed", pair, attemptError);
      }
    }
    const settlements = await reconcileMissingStripeSettlements(db, createStripeBillingProvider());
    return NextResponse.json({ success: true, candidates: pairs.length, succeeded, failed, settlements });
  } catch (error) {
    console.error("Autopay sweep cron error", error);
    return NextResponse.json({ error: "Unable to run autopay sweep." }, { status: 500 });
  }
}
