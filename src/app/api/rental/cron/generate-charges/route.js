import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { mapRentScheduleRow } from "@/domains/rent-schedule";
import { generateRentCharge, mapRentChargeToRow } from "@/domains/rent-charge";
import { finalizeCronRun, startCronRun } from "@/application/rental/cronAudit";

export const runtime = "nodejs";

const JOB_NAME = "generate-charges";
const ROUTE_PATH = "/api/rental/cron/generate-charges";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createRentalWebhookClient();
  const run = await startCronRun(db, { jobName: JOB_NAME, routePath: ROUTE_PATH, request });
  try {
    const period = new Date().toISOString().slice(0, 7);
    const { data: schedules, error } = await db.from("rent_schedules").select("*").eq("status", "active");
    if (error) throw error;

    let processed = 0, failed = 0;
    for (const row of schedules || []) {
      try {
        const charge = generateRentCharge({ schedule: mapRentScheduleRow(row), period });
        if (!charge) continue;
        const { error: upsertError } = await db.from("rent_charges")
          .upsert(mapRentChargeToRow(charge, row.owner_id), { onConflict: "owner_id,source_key", ignoreDuplicates: true });
        if (upsertError) throw upsertError;
        processed += 1;
      } catch (scheduleError) {
        failed += 1;
        console.error("Rent charge generation failed for schedule", row.id, scheduleError);
      }
    }
    const summary = { success: true, period, scheduleCount: (schedules || []).length, processed, failed };
    await finalizeCronRun(db, run, {
      processedCount: (schedules || []).length, succeededCount: processed, failedCount: failed, summary,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Rent charge generation cron error", error);
    await finalizeCronRun(db, run, { status: "failed", failedCount: 1, errorCode: error?.code || null, errorMessage: error?.message });
    return NextResponse.json({ error: "Unable to generate rent charges." }, { status: 500 });
  }
}
