/**
 * Closed field allowlist + status mappings for the rental-ops read
 * projection (mapping version rental-ops-fields@1).
 *
 * The projection is the privacy boundary: only the fields named here
 * can ever be admitted into a snapshot. Names, email, phone, SSN,
 * income, screening, emergency contacts, payment instruments,
 * photographs, descriptions and free-text notes are NOT in the
 * allowlist, so they are dropped at projection time and can never
 * reach the evaluator, the report, or the private Workbench item.
 * Field names keep the source (snake_case) spelling so the reviewed
 * rental read-model classifiers (e.g. isChargeForgeCollectible) apply
 * unchanged.
 */
export const FIELD_MAPPING_VERSION = "rental-ops-fields@1";

export const DATASETS = Object.freeze(["properties", "units", "leases", "memberships", "charges", "schedules"]);

export const FIELD_ALLOWLIST = Object.freeze({
  properties: Object.freeze(["property_ref", "owner_ref"]),
  units: Object.freeze(["unit_ref", "property_ref", "owner_ref", "status"]),
  leases: Object.freeze([
    "lease_ref", "unit_ref", "property_ref", "owner_ref", "status",
    "start_date", "end_date", "monthly_rent_cents", "currency",
    "flag_in_legal_process", "flag_balance_disputed", "flag_safety_concern",
  ]),
  memberships: Object.freeze(["lease_ref", "owner_ref"]),
  charges: Object.freeze([
    "charge_ref", "lease_ref", "schedule_ref", "owner_ref", "status",
    "due_date", "amount_cents", "paid_amount_cents", "currency",
  ]),
  schedules: Object.freeze([
    "schedule_ref", "lease_ref", "owner_ref", "collection_mode", "forge_cutover_date", "currency",
  ]),
});

/** Raw source status -> normalized status. Anything unmapped is UNKNOWN. */
export const LEASE_STATUS_MAP = Object.freeze({
  active: "ACTIVE", draft: "DRAFT", pending: "PENDING",
  ended: "ENDED", terminated: "TERMINATED", cancelled: "CANCELLED",
});
export const UNIT_STATUS_MAP = Object.freeze({
  occupied: "OCCUPIED", vacant: "VACANT", maintenance: "MAINTENANCE",
  offline: "OFFLINE", active: "ACTIVE",
});
export const CHARGE_STATUS_MAP = Object.freeze({
  open: "OPEN", partial: "PARTIAL", paid: "PAID", void: "VOID", written_off: "WRITTEN_OFF",
});

export function mapStatus(map, raw) {
  if (typeof raw !== "string") return "UNKNOWN";
  return Object.prototype.hasOwnProperty.call(map, raw) ? map[raw] : "UNKNOWN";
}

/** Strict YYYY-MM-DD civil date (real calendar day, leap years honored). */
export function isCivilDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Civil-day difference toStr - fromStr for YYYY-MM-DD dates (Rental Manager contract). */
export function civilDayDiff(fromStr, toStr) {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function isSafeNonnegIntCents(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

const SCALAR = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

/**
 * Project one raw source row through the allowlist. Returns
 * { row, dropped, invalid } — dropped lists non-allowlisted field
 * names (never their values), invalid lists allowlisted fields whose
 * values were non-scalar (replaced with undefined; downstream
 * validation turns those into integrity rows, never silent data).
 */
export function projectRow(dataset, raw) {
  const allow = FIELD_ALLOWLIST[dataset];
  if (!allow) throw new Error(`projectRow: unknown dataset ${dataset}`);
  const row = {};
  const dropped = [];
  const invalid = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { row: null, dropped, invalid: ["<row>"] };
  }
  for (const key of Object.keys(raw)) {
    if (!allow.includes(key)) dropped.push(key);
  }
  for (const field of allow) {
    if (!(field in raw)) { row[field] = undefined; continue; }
    const v = raw[field];
    if (!SCALAR(v)) { row[field] = undefined; invalid.push(field); continue; }
    row[field] = v;
  }
  return { row, dropped, invalid };
}
