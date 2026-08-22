import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { mapRentScheduleRow } from "@/domains/rent-schedule";
import { generateRentCharge, mapRentChargeToRow } from "@/domains/rent-charge";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const period = new Date().toISOString().slice(0, 7);
    // Owner-level master pause is checked BEFORE the per-schedule query: an owner whose rental
    // billing is paused must contribute zero eligible schedules, even if individual schedules are
    // already FORGE-activated — this cron runs across every owner, so the pause is applied as an
    // owner_id allowlist rather than a per-row check.
    const { data: enabledSettings, error: settingsError } = await db.from("rental_billing_settings")
      .select("owner_id").eq("billing_enabled", true);
    if (settingsError) throw settingsError;
    const enabledOwnerIds = (enabledSettings || []).map((row) => row.owner_id);

    if (enabledOwnerIds.length === 0) {
      return NextResponse.json({ success: true, period, scheduleCount: 0, processed: 0, failed: 0 });
    }

    // collection_mode='forge' is a required pre-filter, not just an optimization: an 'external' or
    // 'paused' schedule must never generate a FORGE charge, regardless of lifecycle status.
    // generateRentCharge() re-checks this (and the cutover date) itself as the authoritative gate.
    const { data: schedules, error } = await db.from("rent_schedules").select("*")
      .eq("status", "active").eq("collection_mode", "forge").in("owner_id", enabledOwnerIds);
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
    return NextResponse.json({ success: true, period, scheduleCount: (schedules || []).length, processed, failed });
  } catch (error) {
    console.error("Rent charge generation cron error", error);
    return NextResponse.json({ error: "Unable to generate rent charges." }, { status: 500 });
  }
}
