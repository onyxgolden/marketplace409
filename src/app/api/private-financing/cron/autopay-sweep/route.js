import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { executePfAutopayAttempt, currentBillingPeriod } from "@/application/private-financing/executePfAutopayAttempt";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
// Safe to run more than once a day: executePfAutopayAttempt no-ops on an
// (enrollment, billingPeriod) pair that already has an attempt recorded.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const provider = createStripeBillingProvider();
    const now = new Date();
    const billingPeriod = currentBillingPeriod(now);
    const todayDay = now.getUTCDate();
    // Scoped by provider_mode: a preserved sandbox enrollment (even one still marked 'active'
    // from test-key usage) must never be picked up by a live-mode sweep, and vice versa — a
    // borrower must set up autopay again for live payments rather than it silently carrying over.
    const { data: enrollments, error: enrollmentError } = await db.from("private_financing_autopay_enrollments")
      .select("id, owner_id, account_id, borrower_id, charge_day")
      .eq("status", "active").eq("provider_mode", provider.mode);
    if (enrollmentError) throw enrollmentError;

    // The charge day has arrived this month when today's day-of-month reaches it.
    const due = (enrollments || []).filter((enrollment) => Number(enrollment.charge_day) <= todayDay);

    let succeeded = 0, failed = 0, skipped = 0;
    for (const enrollment of due) {
      try {
        const result = await executePfAutopayAttempt(db, enrollment.id, billingPeriod);
        if (result.body?.duplicate) skipped += 1;
        else if (result.httpStatus === 200) succeeded += 1;
        else failed += 1;
      } catch (attemptError) {
        failed += 1;
        console.error("Private financing autopay sweep attempt failed", { enrollmentId: enrollment.id, billingPeriod }, attemptError);
      }
    }
    return NextResponse.json({ success: true, billingPeriod, candidates: due.length, succeeded, failed, skipped });
  } catch (error) {
    console.error("Private financing autopay sweep cron error", error);
    return NextResponse.json({ error: "Unable to run private financing autopay sweep." }, { status: 500 });
  }
}
