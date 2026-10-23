import { isChargeForgeCollectible } from "../../rental/isChargeForgeCollectible.js";
import { ESCALATION_POLICIES } from "./jobContracts.js";
import {
  CHARGE_STATUS_MAP, LEASE_STATUS_MAP, UNIT_STATUS_MAP,
  civilDayDiff, isCivilDate, isSafeNonnegIntCents, mapStatus,
} from "./fieldMappings.js";

export const EVALUATOR_VERSION = "property-manager-evaluator@1";
export const EXPIRATION_HORIZON_DAYS = 60;

/**
 * Property Manager daily exception review over an admitted snapshot.
 *
 * Pure and deterministic: same snapshot bytes in -> same report out.
 * Semantics follow the reviewed Rental Manager read models
 * (buildLeaseExpirationReport: active leases ending within 60 days,
 * already-expired included; buildDelinquentTenantsReport: open
 * overdue = not void, due before today, amount > paid, split by
 * isChargeForgeCollectible) — but over the allowlisted projection
 * only: no names, no contact data, no tenant rows. Vacancy and
 * occupancy are NOT_MODELED: an absent active lease does not prove
 * vacancy. Nothing here is seeded: urgency and flags derive only from
 * admitted fields, and an unknown escalation policy BLOCKS the
 * affected recommendation instead of inventing authority.
 */
export function evaluatePropertyManagerSnapshot(snapshot, { policies = ESCALATION_POLICIES } = {}) {
  const asOfDate = snapshot.as_of_date;
  const rec = snapshot.records;
  const diagnostics = [];
  const integrity = [];
  const pushIntegrity = (kind, dataset, record_ref, extra = {}) =>
    integrity.push({ row_id: `int:${kind}:${record_ref}`, kind, dataset, record_ref, ...extra });

  const unitsByRef = new Map(rec.units.map((u) => [u.unit_ref, u]));
  const propertiesByRef = new Map(rec.properties.map((p) => [p.property_ref, p]));
  const leasesByRef = new Map(rec.leases.map((l) => [l.lease_ref, l]));
  const schedulesByRef = new Map(rec.schedules.map((s) => [s.schedule_ref, s]));
  const memberCountByLease = new Map();
  for (const m of rec.memberships) {
    memberCountByLease.set(m.lease_ref, (memberCountByLease.get(m.lease_ref) ?? 0) + 1);
    if (!leasesByRef.has(m.lease_ref)) pushIntegrity("MEMBERSHIP_LEASE_DANGLING", "memberships", m.lease_ref);
  }
  for (const c of snapshot.conflicts ?? []) {
    pushIntegrity("DUPLICATE_CONFLICT", c.dataset, c.record_ref);
  }

  const span = (dataset, ref) => {
    const s = snapshot.evidence?.[dataset]?.[ref];
    return s ? { dataset, record_ref: ref, sha256: s.sha256 } : null;
  };

  // ---- lease / unit / status integrity -------------------------------
  for (const unit of rec.units) {
    if (!propertiesByRef.has(unit.property_ref)) pushIntegrity("UNIT_PROPERTY_DANGLING", "units", unit.unit_ref);
    if (mapStatus(UNIT_STATUS_MAP, unit.status) === "UNKNOWN") {
      pushIntegrity("UNIT_STATUS_UNSUPPORTED", "units", unit.unit_ref, { source_status: unit.status ?? null });
    }
  }
  for (const lease of rec.leases) {
    if (!unitsByRef.has(lease.unit_ref)) pushIntegrity("LEASE_UNIT_DANGLING", "leases", lease.lease_ref);
    if (!propertiesByRef.has(lease.property_ref)) pushIntegrity("LEASE_PROPERTY_DANGLING", "leases", lease.lease_ref);
    if (mapStatus(LEASE_STATUS_MAP, lease.status) === "UNKNOWN") {
      pushIntegrity("LEASE_STATUS_UNSUPPORTED", "leases", lease.lease_ref, { source_status: lease.status ?? null });
    }
    if (lease.monthly_rent_cents !== undefined && !isSafeNonnegIntCents(lease.monthly_rent_cents)) {
      pushIntegrity("MONEY_INVALID", "leases", lease.lease_ref, { field: "monthly_rent_cents" });
    }
  }

  // ---- lease-expiration exceptions (through 60 days, expired incl.) --
  const expirations = [];
  for (const lease of rec.leases) {
    if (mapStatus(LEASE_STATUS_MAP, lease.status) !== "ACTIVE") continue;
    if (lease.end_date === undefined || lease.end_date === null) {
      pushIntegrity("LEASE_END_DATE_MISSING", "leases", lease.lease_ref);
      continue;
    }
    if (!isCivilDate(lease.end_date)) {
      pushIntegrity("LEASE_END_DATE_INVALID", "leases", lease.lease_ref);
      continue;
    }
    const days = civilDayDiff(asOfDate, lease.end_date);
    if (days > EXPIRATION_HORIZON_DAYS) continue;
    const flags = [];
    if (days < 0) flags.push("EXPIRED_ACTIVE");
    if (days >= 0 && days <= 2) flags.push("EXPIRES_WITHIN_2D");
    if (days >= 0 && days <= 7) flags.push("EXPIRES_WITHIN_7D");
    if (days > 7 && days <= 30) flags.push("EXPIRES_WITHIN_30D");
    if (days > 30 && days <= EXPIRATION_HORIZON_DAYS) flags.push("EXPIRES_WITHIN_60D");
    if (lease.flag_in_legal_process === true) flags.push("LEGAL_PROCESS_FLAGGED");
    if (lease.flag_safety_concern === true) flags.push("SAFETY_FLAGGED");
    expirations.push({
      row_id: `exp:${lease.lease_ref}`,
      kind: "LEASE_EXPIRATION",
      lease_ref: lease.lease_ref,
      unit_ref: lease.unit_ref,
      property_ref: lease.property_ref,
      end_date: lease.end_date,
      days_until_expiration: days,
      already_expired: days < 0,
      member_count: memberCountByLease.get(lease.lease_ref) ?? 0,
      monthly_rent_cents: isSafeNonnegIntCents(lease.monthly_rent_cents) ? lease.monthly_rent_cents : null,
      currency: typeof lease.currency === "string" ? lease.currency : null,
      flags,
      evidence: [span("leases", lease.lease_ref), span("units", lease.unit_ref)].filter(Boolean),
    });
  }
  expirations.sort((a, b) => (a.end_date !== b.end_date
    ? (a.end_date < b.end_date ? -1 : 1)
    : (a.lease_ref < b.lease_ref ? -1 : 1)));

  // ---- overdue balances: FORGE-collectible vs externally managed -----
  const chargesByLease = new Map();
  for (const charge of rec.charges) {
    if (!leasesByRef.has(charge.lease_ref)) {
      pushIntegrity("CHARGE_LEASE_DANGLING", "charges", charge.charge_ref);
      continue;
    }
    const list = chargesByLease.get(charge.lease_ref) ?? [];
    list.push(charge);
    chargesByLease.set(charge.lease_ref, list);
  }
  const overdue = [];
  for (const lease of rec.leases) {
    if (mapStatus(LEASE_STATUS_MAP, lease.status) !== "ACTIVE") continue;
    const charges = chargesByLease.get(lease.lease_ref) ?? [];
    let forgeCents = 0; let forgeCount = 0; let externalCents = 0; let externalCount = 0;
    let oldestForgeDue = null;
    const currencies = new Set();
    const chargeSpans = [];
    for (const charge of charges) {
      if (!schedulesByRef.has(charge.schedule_ref)) {
        pushIntegrity("CHARGE_SCHEDULE_MISSING", "charges", charge.charge_ref);
      }
      if (mapStatus(CHARGE_STATUS_MAP, charge.status) === "VOID") continue;
      if (!isCivilDate(charge.due_date)) {
        pushIntegrity("CHARGE_DUE_DATE_INVALID", "charges", charge.charge_ref);
        continue;
      }
      if (!(charge.due_date < asOfDate)) continue;
      if (!isSafeNonnegIntCents(charge.amount_cents) || !isSafeNonnegIntCents(charge.paid_amount_cents)) {
        pushIntegrity("MONEY_INVALID", "charges", charge.charge_ref);
        continue;
      }
      if (!(charge.amount_cents > charge.paid_amount_cents)) continue;
      const owed = charge.amount_cents - charge.paid_amount_cents;
      if (typeof charge.currency === "string") currencies.add(charge.currency);
      chargeSpans.push(span("charges", charge.charge_ref));
      if (isChargeForgeCollectible(charge, schedulesByRef.get(charge.schedule_ref), asOfDate)) {
        forgeCents += owed; forgeCount += 1;
        if (oldestForgeDue === null || charge.due_date < oldestForgeDue) oldestForgeDue = charge.due_date;
      } else {
        externalCents += owed; externalCount += 1;
      }
    }
    if (forgeCount === 0 && externalCount === 0) continue;
    if (typeof lease.currency === "string") currencies.add(lease.currency);
    const currencyConsistent = currencies.size <= 1;
    if (!currencyConsistent) {
      pushIntegrity("CURRENCY_INCONSISTENT", "leases", lease.lease_ref, { currencies: [...currencies].sort() });
    }
    const flags = [];
    if (forgeCents > 0) flags.push("FORGE_COLLECTIBLE_OVERDUE");
    if (externalCents > 0) flags.push("EXTERNALLY_MANAGED_OVERDUE");
    if (lease.flag_in_legal_process === true) flags.push("LEGAL_PROCESS_FLAGGED");
    if (lease.flag_balance_disputed === true) flags.push("BALANCE_DISPUTED");
    if (lease.flag_safety_concern === true) flags.push("SAFETY_FLAGGED");
    overdue.push({
      row_id: `ovd:${lease.lease_ref}`,
      kind: "OVERDUE_BALANCE",
      lease_ref: lease.lease_ref,
      unit_ref: lease.unit_ref,
      property_ref: lease.property_ref,
      forge_collectible_cents: currencyConsistent ? forgeCents : null,
      forge_charge_count: forgeCount,
      externally_managed_cents: currencyConsistent ? externalCents : null,
      externally_managed_charge_count: externalCount,
      oldest_forge_due_date: oldestForgeDue,
      currency: currencyConsistent ? ([...currencies][0] ?? null) : null,
      totals_blocked: !currencyConsistent,
      flags,
      evidence: [span("leases", lease.lease_ref), ...chargeSpans].filter(Boolean),
    });
  }
  overdue.sort((a, b) => {
    const fa = a.forge_collectible_cents ?? -1;
    const fb = b.forge_collectible_cents ?? -1;
    if (fa !== fb) return fb - fa;
    return a.lease_ref < b.lease_ref ? -1 : 1;
  });

  integrity.sort((a, b) => (a.kind !== b.kind
    ? (a.kind < b.kind ? -1 : 1)
    : (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : 0)));
  for (const row of integrity) {
    row.evidence = [span(row.dataset, row.record_ref)].filter(Boolean);
  }

  // ---- recommendations + escalations (policy-bound, never seeded) ----
  const recommendations = [];
  const escalations = [];
  const urgencyFor = (row) => {
    if (row.flags?.includes("SAFETY_FLAGGED")) return "immediate";
    if (row.kind === "LEASE_EXPIRATION" && (row.already_expired || row.days_until_expiration <= 2)) return "high";
    return "routine";
  };
  const recommend = (row, actionClass, text, touchpoints) => {
    const missing = touchpoints.filter((tp) => !policies[tp]);
    const recRow = {
      row_id: row.row_id,
      action_class: actionClass,
      text,
      status: missing.length ? "BLOCKED" : "PROPOSED",
      touchpoints,
      execution_authorized: false,
    };
    if (missing.length) {
      recRow.blocked_reason = `POLICY_UNKNOWN:${missing.join(",")}`;
      diagnostics.push({ code: "POLICY_UNKNOWN", row_id: row.row_id, touchpoints: missing });
    }
    recommendations.push(recRow);
    if (!missing.length) {
      for (const tp of touchpoints) {
        const policy = policies[tp];
        escalations.push({
          escalation_id: `esc:${row.row_id}:${tp}`,
          row_id: row.row_id,
          touchpoint: tp,
          required_authorizer: policy.required_authorizer,
          executor: policy.executor,
          condition: policy.condition,
          urgency: urgencyFor(row),
          execution_authorized_for_agent: false,
        });
      }
    }
  };
  for (const row of expirations) {
    const tps = ["tenant"];
    if (row.flags.includes("LEGAL_PROCESS_FLAGGED")) tps.push("legal");
    recommend(row, "REVIEW_LEASE_EXPIRATION",
      row.already_expired
        ? `Active lease ${row.lease_ref} passed its end date ${row.end_date} (${-row.days_until_expiration} days ago) — human review of the tenancy state is required.`
        : `Lease ${row.lease_ref} ends ${row.end_date} (in ${row.days_until_expiration} days) — human review before any renewal or tenant-facing step.`,
      tps);
  }
  for (const row of overdue) {
    const tps = ["money"];
    if (row.flags.includes("LEGAL_PROCESS_FLAGGED")) tps.push("legal");
    recommend(row, "REVIEW_OVERDUE_BALANCE",
      row.totals_blocked
        ? `Lease ${row.lease_ref} has overdue charges with inconsistent currencies — totals are blocked pending human reconciliation review.`
        : `Lease ${row.lease_ref} has overdue balances (FORGE-collectible ${row.forge_collectible_cents} cents across ${row.forge_charge_count} charges; externally managed ${row.externally_managed_cents} cents across ${row.externally_managed_charge_count} charges) — human review; externally managed amounts are reconciliation items, not FORGE collections.`,
      tps);
  }
  for (const row of integrity) {
    recommendations.push({
      row_id: row.row_id,
      action_class: "REVIEW_INTEGRITY",
      text: `Source integrity issue ${row.kind} on ${row.dataset} record ${row.record_ref} — data-quality review; no domain conclusion is drawn from this record.`,
      status: "PROPOSED",
      touchpoints: [],
      execution_authorized: false,
    });
  }

  // ---- totals (only over unblocked rows; partial data never "all clear")
  const sumOrNull = (rows, field) => rows.reduce((acc, r) => (r[field] === null ? acc : acc + r[field]), 0);
  const blockedCount = recommendations.filter((r) => r.status === "BLOCKED").length;
  const status = blockedCount > 0 ? "BLOCKED" : (snapshot.consistency === "PARTIAL" ? "PARTIAL" : "PROPOSED");
  if (snapshot.consistency === "PARTIAL") {
    diagnostics.push({ code: "SNAPSHOT_PARTIAL", reason: "snapshot coverage is incomplete or mixed-revision; totals cover admitted records only" });
  }
  if (snapshot.stale) diagnostics.push({ code: "SNAPSHOT_STALE", reason: "collection finished more than 15 minutes before as_of" });
  diagnostics.push({ code: "VACANCY_NOT_MODELED", reason: "an absent active lease does not prove vacancy; vacancy/occupancy need an authoritative mapping (separate scope)" });

  return {
    report_schema: "rental-ops-report@1",
    evaluator_version: EVALUATOR_VERSION,
    agent: "property-manager",
    kind: "property-manager-daily-exception-review",
    owner_ref: snapshot.owner_ref,
    portfolio_ref: snapshot.portfolio_ref,
    as_of: snapshot.as_of,
    as_of_date: asOfDate,
    as_of_timezone: snapshot.as_of_timezone,
    window: { name: "lease-expiration-60d", horizon_days: EXPIRATION_HORIZON_DAYS },
    snapshot_digest: snapshot.digest,
    snapshot_consistency: snapshot.consistency,
    coverage: snapshot.datasets,
    status,
    sections: {
      lease_expirations: { rows: expirations, count: expirations.length },
      overdue_balances: {
        rows: overdue,
        forge_collectible_total_cents: sumOrNull(overdue, "forge_collectible_cents"),
        externally_managed_total_cents: sumOrNull(overdue, "externally_managed_cents"),
        blocked_row_count: overdue.filter((r) => r.totals_blocked).length,
      },
      integrity: { rows: integrity, count: integrity.length },
      vacancy_assessment: "NOT_MODELED",
      occupancy_assessment: "NOT_MODELED",
    },
    recommendations,
    escalations,
    exclusions: (snapshot.collection_errors ?? []).map((e) => ({ dataset: e.dataset, code: e.code })),
    diagnostics,
    no_exceptions_found: status === "PROPOSED"
      && expirations.length === 0 && overdue.length === 0 && integrity.length === 0,
    execution_authorized: false,
  };
}
