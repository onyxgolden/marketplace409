// SaaS 30-day trial — hourly expiry worker.
//
// GET /api/forge/platform/trials/expire runs
// forge_app_trial_expire_due (worker-role only, EXECUTE to
// service_role). The live predicate denies an expired trial even if
// this worker never runs; the worker only flips the stored status to
// 'expired' and writes the system audit receipt. Idempotent: a
// re-run finds nothing due.
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
// when CRON_SECRET is set in the project env — see vercel.json for the
// schedule. No public client endpoint, no client-supplied owner/app list.
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

export const runtime = "nodejs";

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createRentalWebhookClient();
  const { data, error } = await db.rpc("forge_app_trial_expire_due");
  if (error) {
    console.error("trial expiry worker failed", error);
    return NextResponse.json({ error: "Unable to complete the request." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}
