import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { mapRentScheduleRow, paymentFrequencyOf, paymentAnchorDate, dueDatesInWindow } from "@/domains/rent-schedule";
import { generateRentCharge, mapRentChargeToRow } from "@/domains/rent-charge";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;
function addDays(dateStr, days) {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// R13: the periods this schedule needs charges for. Monthly keeps its exact
// prior behavior (current month + next month inside the early-pay window).
// Weekly/bi-weekly schedules generate every cadence occurrence with a due
// date in [today - stepDays, today + earlyPayDays]: the current period always
// generates (mirroring monthly), the next inside the early-pay window, and
// nothing older is backfilled. The occurrence list is deterministic and the
// upsert below is keyed on (owner_id, source_key), so daily runs can neither
// double-generate nor skip an occurrence.
function chargePeriodsForSchedule(schedule, { period, nextPeriod, todayStr }) {
  const frequency = paymentFrequencyOf(schedule);
  if (frequency === "monthly") {
    const periods = [period];
    if (nextPeriod !== period) {
      const nextDueDate = `${nextPeriod}-${String(schedule.dueDay).padStart(2, "0")}`;
      const daysUntilDue = Math.round((Date.parse(`${nextDueDate}T00:00:00.000Z`) - Date.parse(`${todayStr}T00:00:00.000Z`)) / DAY_MS);
      if (daysUntilDue <= (schedule.earlyPayDays ?? 7)) periods.push(nextPeriod);
    }
    return periods;
  }
  const stepDays = frequency === "weekly" ? 7 : 14;
  return dueDatesInWindow({
    anchorDate: paymentAnchorDate(schedule),
    frequency,
    windowStart: addDays(todayStr, -stepDays),
    windowEnd: addDays(todayStr, schedule.earlyPayDays ?? 7),
  });
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const now = new Date();
    const period = now.toISOString().slice(0, 7);
    const todayStr = now.toISOString().slice(0, 10);
    // Next month's period — generated early only when inside the schedule's early-pay window,
    // so the owner controls how far ahead a tenant can pay (default 7 days before due date).
    const nextPeriodDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextPeriod = nextPeriodDate.toISOString().slice(0, 7);
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

    // R10: the begin-charges date lives on the lease (rental_leases), not the
    // schedule — one extra owner-scoped lookup maps it onto each schedule so
    // generateRentCharge() can gate on it. A lease row missing its date (or
    // missing entirely) falls back to no gate: pre-R10 behavior, never a
    // newly blocked charge.
    const leaseIds = [...new Set((schedules || []).map((row) => row.lease_id).filter(Boolean))];
    const { data: leaseRows, error: leaseError } = leaseIds.length
      ? await db.from("rental_leases").select("id, begin_charges_date").in("id", leaseIds).in("owner_id", enabledOwnerIds)
      : { data: [], error: null };
    if (leaseError) throw leaseError;
    const beginChargesByLease = new Map((leaseRows || []).map((lease) => [lease.id, lease.begin_charges_date ?? null]));

    let processed = 0, failed = 0;
    for (const row of schedules || []) {
      try {
        const schedule = { ...mapRentScheduleRow(row), beginChargesDate: beginChargesByLease.get(row.lease_id) ?? null };
        for (const p of chargePeriodsForSchedule(schedule, { period, nextPeriod, todayStr })) {
          const charge = generateRentCharge({ schedule, period: p });
          if (!charge) continue;
          const { error: upsertError } = await db.from("rent_charges")
            .upsert(mapRentChargeToRow(charge, row.owner_id), { onConflict: "owner_id,source_key", ignoreDuplicates: true });
          if (upsertError) throw upsertError;
          processed += 1;
        }
      } catch (scheduleError) {
        failed += 1;
        console.error("Rent charge generation failed for schedule", row.id, scheduleError);
      }
    }
    return NextResponse.json({ success: true, period, nextPeriod, scheduleCount: (schedules || []).length, processed, failed });
  } catch (error) {
    console.error("Rent charge generation cron error", error);
    return NextResponse.json({ error: "Unable to generate rent charges." }, { status: 500 });
  }
}
