// evaluateSlots (Slice 4 / W1) — expected-slot computation and slot states.
//
// A slot is one expected execution: { capability_id, expected_at (UTC ISO),
// grace_hours }. States per the watchdog architecture:
// - "pending": grace has not expired; not evaluable yet.
// - "observed-success": attributable evidence proves execution in the slot.
// - "confirmed-miss": grace expired, evidence source healthy, and no
//   attributable evidence for the slot — ONLY for execution-attempt logs
//   and workflow-exclusive sources (Slice 3 semantics).
// - "ambiguous": evidence unavailable, unattributable, or business
//   effects only (idle indistinguishable from missed).
// - "configuration-error": the registry and the repo disagree (e.g. a
//   workflow file the registry names does not exist).
//
// Chicago DST is handled honestly: fixed-utc crons fire at fixed UTC;
// dst-guarded pairs resolve to the slot matching today's Chicago offset;
// dual-fire pairs produce two slots a day.

/** Chicago's UTC offset in whole hours for a given date (-5 CDT, -6 CST). */
export function chicagoUtcOffsetHours(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const chicagoAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((chicagoAsUtc - date.getTime()) / 3600000);
}

function parseCron(cron) {
  const [m, h] = cron.trim().split(/\s+/).slice(0, 2).map(Number);
  return { minute: m, hour: h };
}

/**
 * Effective UTC crons for a capability on a given date.
 * Returns [{ minute, hour }] — one entry per expected slot that day.
 */
export function effectiveCronsForDate(capability, date) {
  const t = capability.trigger;
  if (!t || t.kind !== "schedule") return [];
  if (t.dst === "fixed-utc") {
    return [parseCron(t.cron)];
  }
  if (t.dst === "dual-fire") {
    return t.crons.map(parseCron);
  }
  if (t.dst === "dst-guarded") {
    const sorted = t.crons.map(parseCron).sort((a, b) => a.hour - b.hour);
    // Earlier UTC slot serves CDT days (UTC-5), later serves CST days.
    return [chicagoUtcOffsetHours(date) === -5 ? sorted[0] : sorted[1]];
  }
  return [];
}

/**
 * Recent expected slots for a capability: today and yesterday (UTC),
 * most recent first. grace_hours: 3h daily, 2h twice-daily.
 */
export function expectedSlots(capability, now) {
  const t = capability.trigger;
  if (!t || t.kind !== "schedule") return [];
  const grace_hours = capability.expected_cadence === "twice daily" ? 2 : 3;
  const slots = [];
  const nowMs = now instanceof Date ? now.getTime() : now;
  for (let dayBack = 0; dayBack <= 1; dayBack += 1) {
    const date = new Date(nowMs - dayBack * 86400000);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth();
    const d = date.getUTCDate();
    for (const c of effectiveCronsForDate(capability, date)) {
      const expected_at = new Date(Date.UTC(y, mo, d, c.hour, c.minute)).toISOString();
      if (new Date(expected_at).getTime() <= nowMs) {
        slots.push({ capability_id: capability.id, expected_at, grace_hours });
      }
    }
  }
  slots.sort((a, b) => (a.expected_at < b.expected_at ? 1 : -1));
  return slots;
}

export const SLOT_STATES = Object.freeze([
  "pending",
  "observed-success",
  "confirmed-miss",
  "ambiguous",
  "configuration-error",
]);
