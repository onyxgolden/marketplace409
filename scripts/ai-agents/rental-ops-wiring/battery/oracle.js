/**
 * Independent battery oracle. Written directly from the P2a brief's
 * domain rules; imports NOTHING from the evaluator, the snapshot
 * builder or the collectible classifier. It predicts, for a battery
 * case: expiration rows (lease_ref -> days until expiration), overdue
 * rows (lease_ref -> [forge_cents, external_cents] plus the set of
 * currency-blocked leases), the multiset of integrity kinds, and the
 * report status. The battery compares the runner's actual report
 * against this prediction — two implementations of one spec.
 */

const DAY = 86400000;
function dayDiff(fromStr, toStr) {
  return Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / DAY);
}
function chicagoDate(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isMoney = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
// The collectible rule, restated from the brief's fail-safe wording:
// FORGE-collectible only when the schedule says forge, a cutover
// exists, the cutover has arrived, and the charge is due on/after it.
// Anything unresolved is externally managed.
function collectible(charge, schedule, asOfDate) {
  if (!schedule) return false;
  if (schedule.collection_mode !== "forge") return false;
  if (schedule.forge_cutover_date === null || schedule.forge_cutover_date === undefined) return false;
  if (schedule.forge_cutover_date > asOfDate) return false;
  if (charge.due_date < schedule.forge_cutover_date) return false;
  return true;
}

const REF = { properties: "property_ref", units: "unit_ref", leases: "lease_ref", memberships: "lease_ref", charges: "charge_ref", schedules: "schedule_ref" };
const LEASE_KNOWN = new Set(["active", "draft", "pending", "ended", "terminated", "cancelled"]);
const UNIT_KNOWN = new Set(["occupied", "vacant", "maintenance", "offline", "active"]);

export function oraclePredict(caseSpec) {
  const faults = caseSpec.faults ?? {};
  const owner = caseSpec.request.owner_ref;
  const asOfDate = chicagoDate(caseSpec.request.as_of);
  let partial = false;
  const kinds = [];
  const kind = (k) => kinds.push(k);

  const admitted = {};
  for (const ds of ["properties", "units", "leases", "memberships", "charges", "schedules"]) {
    if (faults.failDataset === ds || faults.blockedDataset === ds) {
      admitted[ds] = [];
      partial = true;
      continue;
    }
    if (faults.cursorLoopDataset === ds) partial = true; // first page admitted, coverage incomplete
    let rows = (caseSpec.datasets[ds] ?? []).filter((r) => r !== null && typeof r === "object" && r.owner_ref === owner);
    if (ds !== "memberships") {
      const seen = new Map();
      const kept = [];
      for (const row of rows) {
        const ref = row[REF[ds]];
        if (typeof ref !== "string" || ref.length === 0) { partial = true; continue; }
        if (seen.has(ref)) {
          if (JSON.stringify(seen.get(ref)) !== JSON.stringify(row)) { partial = true; kind("DUPLICATE_CONFLICT"); }
          continue;
        }
        seen.set(ref, row);
        kept.push(row);
      }
      rows = kept;
    }
    admitted[ds] = rows;
  }
  if (faults.mixedRevisions) partial = true;
  if (caseSpec.clock_iso && (Date.parse(caseSpec.request.as_of) - Date.parse(caseSpec.clock_iso)) > 15 * 60 * 1000) partial = true;

  const units = new Map(admitted.units.map((u) => [u.unit_ref, u]));
  const props = new Map(admitted.properties.map((p) => [p.property_ref, p]));
  const leases = new Map(admitted.leases.map((l) => [l.lease_ref, l]));
  const schedules = new Map(admitted.schedules.map((s) => [s.schedule_ref, s]));

  for (const m of admitted.memberships) {
    if (typeof m.lease_ref !== "string" || m.lease_ref.length === 0) { partial = true; continue; }
    if (!leases.has(m.lease_ref)) kind("MEMBERSHIP_LEASE_DANGLING");
  }
  for (const u of admitted.units) {
    if (!props.has(u.property_ref)) kind("UNIT_PROPERTY_DANGLING");
    if (!UNIT_KNOWN.has(u.status)) kind("UNIT_STATUS_UNSUPPORTED");
  }
  const expirations = {};
  for (const lease of admitted.leases) {
    if (!units.has(lease.unit_ref)) kind("LEASE_UNIT_DANGLING");
    if (!props.has(lease.property_ref)) kind("LEASE_PROPERTY_DANGLING");
    if (!LEASE_KNOWN.has(lease.status)) kind("LEASE_STATUS_UNSUPPORTED");
    if (lease.monthly_rent_cents !== undefined && !isMoney(lease.monthly_rent_cents)) kind("MONEY_INVALID");
    if (lease.status !== "active") continue;
    if (lease.end_date === undefined || lease.end_date === null) { kind("LEASE_END_DATE_MISSING"); continue; }
    if (!isDate(lease.end_date)) { kind("LEASE_END_DATE_INVALID"); continue; }
    const days = dayDiff(asOfDate, lease.end_date);
    if (days <= 60) expirations[lease.lease_ref] = days;
  }

  const overdue = {};
  const blocked = [];
  const chargesByLease = new Map();
  for (const c of admitted.charges) {
    if (!leases.has(c.lease_ref)) { kind("CHARGE_LEASE_DANGLING"); continue; }
    const list = chargesByLease.get(c.lease_ref) ?? [];
    list.push(c);
    chargesByLease.set(c.lease_ref, list);
  }
  for (const lease of admitted.leases) {
    if (lease.status !== "active") continue;
    let forge = 0; let external = 0; let any = false;
    const currencies = new Set();
    for (const c of chargesByLease.get(lease.lease_ref) ?? []) {
      if (!schedules.has(c.schedule_ref)) kind("CHARGE_SCHEDULE_MISSING");
      if (c.status === "void") continue;
      if (!isDate(c.due_date)) { kind("CHARGE_DUE_DATE_INVALID"); continue; }
      if (!(c.due_date < asOfDate)) continue;
      if (!isMoney(c.amount_cents) || !isMoney(c.paid_amount_cents)) { kind("MONEY_INVALID"); continue; }
      if (!(c.amount_cents > c.paid_amount_cents)) continue;
      any = true;
      if (typeof c.currency === "string") currencies.add(c.currency);
      const owed = c.amount_cents - c.paid_amount_cents;
      if (collectible(c, schedules.get(c.schedule_ref), asOfDate)) forge += owed; else external += owed;
    }
    if (!any) continue;
    if (typeof lease.currency === "string") currencies.add(lease.currency);
    if (currencies.size > 1) { kind("CURRENCY_INCONSISTENT"); blocked.push(lease.lease_ref); continue; }
    overdue[lease.lease_ref] = [forge, external];
  }

  return {
    expirations, overdue, blocked_leases: blocked.sort(),
    integrity_kinds: kinds.sort(),
    status: partial ? "PARTIAL" : "PROPOSED",
  };
}
