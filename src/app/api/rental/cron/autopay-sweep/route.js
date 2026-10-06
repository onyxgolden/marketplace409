import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { runRentalAutopaySweep } from "./sweepRunner.js";

export const runtime = "nodejs";

// Primary trigger: GitHub Actions schedule (moved to 23 8 * * * UTC /
// 3:23 AM CDT on 2026-10-06 after the 0 7 * * * slot silently missed
// 2026-10-05 and 2026-10-06 -- GitHub documents that scheduled runs can be
// dropped under load, minute 00 named explicitly as a high-load point).
// Safe to run more than once a day: executeAutopayAttempt no-ops on an
// (enrollment, charge) pair that already has an attempt recorded.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const provider = createStripeBillingProvider();
    const today = new Date().toISOString().slice(0, 10);
    // Recovery provenance: the GitHub workflow appends ?trigger=manual for
    // workflow_dispatch runs; the watchdog passes 'watchdog' itself.
    const triggerParam = new URL(request.url).searchParams.get("trigger");
    const triggeredBy = triggerParam === "manual" ? "manual" : "schedule";
    const result = await runRentalAutopaySweep({ db, provider, today, triggeredBy });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Autopay sweep cron error", error);
    return NextResponse.json({ error: "Unable to run autopay sweep." }, { status: 500 });
  }
}
