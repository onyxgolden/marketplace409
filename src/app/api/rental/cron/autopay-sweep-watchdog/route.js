import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import {
  RENTAL_AUTOPAY_SWEEP_NAME,
  runRentalAutopaySweep,
  sweepCompletedToday,
} from "../autopay-sweep/sweepRunner.js";

export const runtime = "nodejs";

// Recovery watchdog for the rental autopay sweep.
//
// Trigger this from an INDEPENDENT scheduler -- not GitHub Actions. A GitHub
// cron watching a GitHub cron shares the exact scheduler failure mode that
// silently dropped the 02:00 CDT sweep on 2026-10-05 and 2026-10-06.
//
// The watchdog checks durable sweep evidence (rental_sweep_runs), not the
// Actions API: if today's sweep already completed it is a NO-OP; otherwise
// it runs the same idempotent sweep and records triggered_by='watchdog'
// as recovery provenance.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const today = new Date().toISOString().slice(0, 10);
    if (await sweepCompletedToday(db, RENTAL_AUTOPAY_SWEEP_NAME, today)) {
      return NextResponse.json({ success: true, recovered: false, reason: "sweep already completed today" });
    }
    const provider = createStripeBillingProvider();
    const result = await runRentalAutopaySweep({ db, provider, today, triggeredBy: "watchdog" });
    return NextResponse.json({ success: true, recovered: true, ...result });
  } catch (error) {
    console.error("Autopay sweep watchdog error", error);
    return NextResponse.json({ error: "Unable to run autopay sweep watchdog." }, { status: 500 });
  }
}
