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
  for (const g of snapshot.coverage_gaps ?? []) {
    pushIntegrity(g.code, g.dataset, "coverage", g.detail ? { detail: g.detail } : {});
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
  //
  // Totals discipline: a charge contributes to a total only when every
  // fact its classification depends on is verified — a known status, a
  // valid linked schedule with a valid cutover date, a valid currency,
  // and safe integer arithmetic. Anything unverified withholds the
  // charge from the sums and blocks the lease's totals with a NAMED
  // reason (never a plausible zero). Unknown classification never
  // masquerades as verified FORGE/external evidence.
  const CURRENCY_RE = /^[A-Z]{3}$/;
  const validCurrency = (c) => typeof c === "string" && CURRENCY_RE.test(c);
  const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
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
    let forgeCents = 0n; let forgeCount = 0; let externalCents = 0n; let externalCount = 0;
    let oldestForgeDue = null;
    let unverified = null; // named reason the lease's totals are blocked
    const currencies = new Set();
    const chargeSpans = [];
    for (const charge of charges) {
      const statusMapped = mapStatus(CHARGE_STATUS_MAP, charge.status);
      if (statusMapped === "UNKNOWN") {
        pushIntegrity("CHARGE_STATUS_UNSUPPORTED", "charges", charge.charge_ref, { source_status: charge.status ?? null });
        unverified = unverified ?? "CLASSIFICATION_UNVERIFIED";
        continue;
      }
      if (statusMapped === "VOID") continue;
      const schedule = schedulesByRef.get(charge.schedule_ref);
      let classificationOk = true;
      if (charge.schedule_ref !== undefined && charge.schedule_ref !== null && !schedule) {
        pushIntegrity("CHARGE_SCHEDULE_MISSING", "charges", charge.charge_ref);
        classificationOk = false;
      }
      if (schedule) {
        if (!leasesByRef.has(schedule.lease_ref)) {
          pushIntegrity("SCHEDULE_LEASE_DANGLING", "schedules", schedule.schedule_ref, { lease_ref: schedule.lease_ref ?? null });
          classificationOk = false;
        }
        if (schedule.forge_cutover_date !== undefined && schedule.forge_cutover_date !== null
          && !isCivilDate(schedule.forge_cutover_date)) {
          pushIntegrity("SCHEDULE_CUTOVER_INVALID", "schedules", schedule.schedule_ref, { forge_cutover_date: schedule.forge_cutover_date });
          classificationOk = false;
        }
      }
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
      if (!validCurrency(charge.currency)) {
        pushIntegrity("CURRENCY_UNVERIFIED", "charges", charge.charge_ref, { currency: charge.currency ?? null });
        unverified = unverified ?? "CURRENCY_UNVERIFIED";
        continue;
      }
      if (!classificationOk) {
        unverified = unverified ?? "CLASSIFICATION_UNVERIFIED";
        continue;
      }
      const owed = BigInt(charge.amount_cents - charge.paid_amount_cents);
      currencies.add(charge.currency);
      chargeSpans.push(span("charges", charge.charge_ref));
      if (isChargeForgeCollectible(charge, schedule, asOfDate)) {
        forgeCents += owed; forgeCount += 1;
        if (oldestForgeDue === null || charge.due_date < oldestForgeDue) oldestForgeDue = charge.due_date;
      } else {
        externalCents += owed; externalCount += 1;
      }
    }
    if (forgeCount === 0 && externalCount === 0 && unverified === null) continue;
    if (!validCurrency(lease.currency)) {
      pushIntegrity("CURRENCY_UNVERIFIED", "leases", lease.lease_ref, { currency: lease.currency ?? null });
      unverified = unverified ?? "CURRENCY_UNVERIFIED";
    } else {
      currencies.add(lease.currency);
    }
    const currencyConsistent = currencies.size <= 1;
    if (!currencyConsistent) {
      pushIntegrity("CURRENCY_INCONSISTENT", "leases", lease.lease_ref, { currencies: [...currencies].sort() });
      unverified = unverified ?? "CURRENCY_INCONSISTENT";
    }
    if (forgeCents > MAX_CENTS || externalCents > MAX_CENTS) {
      pushIntegrity("TOTALS_OVERFLOW", "leases", lease.lease_ref);
      unverified = "TOTALS_OVERFLOW";
    }
    const blocked = unverified !== null;
    const flags = [];
    if (!blocked && forgeCents > 0n) flags.push("FORGE_COLLECTIBLE_OVERDUE");
    if (!blocked && externalCents > 0n) flags.push("EXTERNALLY_MANAGED_OVERDUE");
    if (lease.flag_in_legal_process === true) flags.push("LEGAL_PROCESS_FLAGGED");
    if (lease.flag_balance_disputed === true) flags.push("BALANCE_DISPUTED");
    if (lease.flag_safety_concern === true) flags.push("SAFETY_FLAGGED");
    overdue.push({
      row_id: `ovd:${lease.lease_ref}`,
      kind: "OVERDUE_BALANCE",
      lease_ref: lease.lease_ref,
      unit_ref: lease.unit_ref,
      property_ref: lease.property_ref,
      forge_collectible_cents: blocked ? null : Number(forgeCents),
      forge_charge_count: forgeCount,
      externally_managed_cents: blocked ? null : Number(externalCents),
      externally_managed_charge_count: externalCount,
      oldest_forge_due_date: oldestForgeDue,
      currency: blocked ? null : ([...currencies][0] ?? null),
      totals_blocked: blocked,
      ...(blocked ? { blocked_reason: unverified } : {}),
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

  // ---- totals: unavailable (null + named reason), never a plausible
  // zero or a partial sum, when coverage is incomplete, any row is
  // blocked, or contributing rows span more than one currency.
  const chargesComplete = snapshot.datasets?.charges?.complete === true;
  const schedulesComplete = snapshot.datasets?.schedules?.complete === true;
  const coverageOk = chargesComplete && schedulesComplete;
  const anyRowBlocked = overdue.some((r) => r.totals_blocked);
  const rowCurrencies = new Set(overdue.filter((r) => !r.totals_blocked && r.currency).map((r) => r.currency));
  const totalsAvailable = coverageOk && !anyRowBlocked && rowCurrencies.size <= 1;
  const sumField = (field) => overdue.reduce((acc, r) => acc + (r[field] ?? 0), 0);
  const totalsUnavailableReason = !coverageOk ? "COVERAGE_INCOMPLETE"
    : anyRowBlocked ? "ROW_BLOCKED"
    : rowCurrencies.size > 1 ? "CURRENCY_INCONSISTENT" : null;
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
        forge_collectible_total_cents: totalsAvailable ? sumField("forge_collectible_cents") : null,
        externally_managed_total_cents: totalsAvailable ? sumField("externally_managed_cents") : null,
        blocked_row_count: overdue.filter((r) => r.totals_blocked).length,
        totals_unavailable: !totalsAvailable,
        ...(totalsAvailable ? {} : { totals_unavailable_reason: totalsUnavailableReason }),
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
