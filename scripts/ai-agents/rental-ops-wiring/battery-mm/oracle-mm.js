/**
 * Independent Maintenance Manager battery oracle. Written directly
 * from the P2a brief's P2a-2 domain rules; imports NOTHING from the
 * evaluator, the snapshot builder or the field mappings. It predicts,
 * for a battery case: backlog rows (work_order_ref -> age/due/
 * priority/status facts), the overdue set, unknown due/age counts,
 * the multiset of integrity kinds, and the report status. The battery
 * compares the runner's actual report against this prediction — two
 * implementations of one spec.
 */

const DAY = 86400000;
function dayDiff(fromStr, toStr) {
  return Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / DAY);
}
// The brief's P2a-2 convention is civil UTC day aging (P670-001):
// the evaluation date is the UTC civil date of the as_of instant,
// NOT the America/Chicago date the shared snapshot envelope carries
// for the Property Manager. (The earlier version of this oracle
// repeated the evaluator's Chicago-clock error; it is corrected to
// the brief here, not treated as ground truth.)
function utcCivilDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
function binOf(age) {
  if (age <= 7) return "bin_0_7";
  if (age <= 30) return "bin_8_30";
  if (age <= 90) return "bin_31_90";
  return "bin_91_plus";
}

// Closed source-status mapping, restated from the brief (confirmed
// against buildWorkOrdersReport.js OPEN_STATUSES).
const WO_MAP = { draft: "OPEN", assigned: "OPEN", scheduled: "OPEN", in_progress: "IN_PROGRESS", completed: "COMPLETED", cancelled: "CANCELLED" };
// Actual source priority enum, restated from the brief's schema
// confirmation (rental_maintenance_requests.priority +
// MAINTENANCE_PRIORITY_WEIGHT).
const PRIORITIES = new Set(["urgent", "emergency", "high", "normal", "medium", "low"]);

export function oraclePredict(caseSpec) {
  const faults = caseSpec.faults ?? {};
  const owner = caseSpec.request.owner_ref;
  const asOfDate = utcCivilDate(caseSpec.request.as_of);
  let partial = false;
  const kinds = [];
  const kind = (k) => kinds.push(k);

  const admitted = {};
  // The MM job collects its narrow dataset list only (P2a-2); faults
  // against uncollected datasets cannot occur.
  for (const ds of ["properties", "units", "work_orders"]) {
    if (faults.failDataset === ds || faults.blockedDataset === ds) {
      admitted[ds] = [];
      partial = true;
      continue;
    }
    if (faults.cursorLoopDataset === ds) partial = true;
    if (faults.hideExpected === true) { partial = true; kind("COVERAGE_UNATTESTED"); }
    const REF_KEY = { properties: "property_ref", units: "unit_ref", work_orders: "work_order_ref" };
    let rows = (caseSpec.datasets[ds] ?? []).filter((r) => r !== null && typeof r === "object" && r.owner_ref === owner);
    const seen = new Map();
    const kept = [];
    for (const row of rows) {
      const refKey = row[REF_KEY[ds]];
      if (typeof refKey !== "string" || refKey.length === 0) { partial = true; continue; }
      if (seen.has(refKey)) {
        if (JSON.stringify(seen.get(refKey)) !== JSON.stringify(row)) { partial = true; kind("DUPLICATE_CONFLICT"); }
        continue;
      }
      seen.set(refKey, row);
      kept.push(row);
    }
    admitted[ds] = kept;
  }
  if (faults.mixedRevisions) { partial = true; kind("REVISION_UNATTESTED"); }
  if (caseSpec.clock_iso && (Date.parse(caseSpec.request.as_of) - Date.parse(caseSpec.clock_iso)) > 15 * 60 * 1000) partial = true;

  const units = new Map(admitted.units.map((u) => [u.unit_ref, u]));
  const props = new Map(admitted.properties.map((p) => [p.property_ref, p]));

  const backlog = {};
  const overdue = [];
  let unknownDue = 0;
  let unknownAge = 0;
  for (const w of admitted.work_orders) {
    const ref = w.work_order_ref;
    if (w.unit_ref !== undefined && w.unit_ref !== null && !units.has(w.unit_ref)) kind("WO_UNIT_DANGLING");
    if (w.property_ref !== undefined && w.property_ref !== null && !props.has(w.property_ref)) kind("WO_PROPERTY_DANGLING");
    // P670-003: linkage must agree, not merely resolve — a work order
    // naming a unit and a property whose admitted unit belongs to a
    // different property is a named mismatch.
    if (w.unit_ref !== undefined && w.unit_ref !== null && units.has(w.unit_ref)
      && w.property_ref !== undefined && w.property_ref !== null
      && units.get(w.unit_ref).property_ref !== w.property_ref) kind("WO_UNIT_PROPERTY_MISMATCH");
    const mapped = typeof w.status === "string" && WO_MAP[w.status] ? WO_MAP[w.status] : "UNKNOWN";
    if (mapped === "UNKNOWN") { kind("WO_STATUS_UNSUPPORTED"); continue; }
    if (mapped === "COMPLETED" || mapped === "CANCELLED") continue;

    let age = null;
    let bin = "unknown";
    if (w.created_date === undefined || w.created_date === null) { kind("WO_CREATED_DATE_MISSING"); unknownAge += 1; }
    else if (!isDate(w.created_date)) { kind("WO_CREATED_DATE_INVALID"); unknownAge += 1; }
    else {
      age = dayDiff(w.created_date, asOfDate);
      // P670-002: a future creation date is a named integrity
      // condition with unknown/unverifiable age — never a verified
      // negative age and never clamped to zero.
      if (age < 0) { kind("WO_CREATED_DATE_IN_FUTURE"); age = null; unknownAge += 1; }
      else bin = binOf(age);
    }

    let priority = "unclassified";
    if (w.priority !== undefined && w.priority !== null) {
      if (typeof w.priority === "string" && PRIORITIES.has(w.priority.toLowerCase())) {
        priority = w.priority.toLowerCase();
      } else {
        kind("PRIORITY_UNRECOGNIZED");
      }
    }

    let due = "UNKNOWN";
    if (w.due_date !== undefined && w.due_date !== null) {
      if (!isDate(w.due_date)) kind("WO_DUE_DATE_INVALID");
      else if (w.due_date < asOfDate) due = "OVERDUE";
      else if (w.due_date === asOfDate) due = "DUE_TODAY";
      else due = "FUTURE";
    }
    if (due === "UNKNOWN") unknownDue += 1;
    if (due === "OVERDUE") overdue.push(ref);
    if (w.completed_date !== undefined && w.completed_date !== null && !isDate(w.completed_date)) {
      kind("WO_COMPLETED_DATE_INVALID");
    }
    backlog[ref] = { age_days: age, age_bin: bin, priority, due_state: due, status: mapped };
  }

  kinds.sort();
  return {
    backlog,
    overdue: overdue.sort(),
    unknown_due_count: unknownDue,
    unknown_age_count: unknownAge,
    integrity_kinds: kinds,
    status: partial ? "PARTIAL" : "PROPOSED",
  };
}
