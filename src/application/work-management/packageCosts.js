// FORGE Work Management — package planned-vs-actual cost application service.
//
// Read-only actuals over owner-scoped, user-confirmed cost_attributed links.
// This service deliberately queries:
//   * the package by effective owner + package id;
//   * rental_units by effective owner (to derive exact unit ids for the
//     package's canonical property);
//   * forge_work_links by effective owner + cost_attributed + the exact
//     financial_event -> work_package orientation, first for this package and
//     then only for the finite event ids those package links name (so an
//     event attributed to multiple packages can be flagged without scanning
//     unrelated links; status/provenance are classified by the pure builder
//     so exclusions remain auditable);
//   * financial_events by effective owner + the finite linked event ids;
//   * rental_contractor_payments by effective owner + the finite explicit
//     payment ids referenced by those events; and
//   * a bounded latest-first budget revision history for this package.
//
// No property-wide total is inferred and no financial records are written.

import {
  buildPackageCostSummary,
  normalizePlannedCostCents,
} from "@/domains/work-management/packageCosts.js";
import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";
import { contractorPaymentIdOf } from "@/domains/rental/financialEventRules.js";

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 500;
const EVENT_COLUMNS = [
  "id", "owner_id", "event_date", "description", "amount", "transaction_kind",
  "property_id", "source_system", "source_record_id", "metadata", "status",
  "is_deleted",
].join(", ");

async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunks(values) {
  const result = [];
  for (let index = 0; index < values.length; index += ID_CHUNK_SIZE) {
    result.push(values.slice(index, index + ID_CHUNK_SIZE));
  }
  return result;
}

export async function getPackageCostSummary(db, { ownerId, packageId }) {
  const { data: pkg, error: packageError } = await db.from("forge_work_packages")
    .select("id, owner_id, property_id, planned_cost_cents, status, version, updated_at")
    .eq("owner_id", ownerId)
    .eq("id", packageId)
    .maybeSingle();
  if (packageError) throw packageError;
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const units = await fetchAllPages(() => db.from("rental_units")
    .select("id, property_id")
    .eq("owner_id", ownerId)
    .order("id", { ascending: true }));

  const packageProperty = pkg.property_id ? canonicalPropertySlug(pkg.property_id) : null;
  const unitIds = packageProperty
    ? units
      .filter((unit) => unit.property_id && canonicalPropertySlug(unit.property_id) === packageProperty)
      .map((unit) => unit.id)
      .filter(Boolean)
    : [];

  const packageLinks = await fetchAllPages(() => db.from("forge_work_links")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("relationship_type", "cost_attributed")
    .eq("source_domain", "financial")
    .eq("source_type", "financial_event")
    .eq("target_domain", "workmgmt")
    .eq("target_type", "work_package")
    .eq("target_id", packageId)
    .order("source_id", { ascending: true })
    .order("id", { ascending: true }));

  const packageEventIds = [...new Set(
    packageLinks.map((link) => link.source_id).filter(Boolean),
  )].sort();

  // Attribution context for exactly those events: the same event may be
  // actively attributed to another package, in which case it is ambiguous
  // everywhere. This query is bounded by the finite linked event ids above;
  // it never scans unrelated cost links.
  const linksById = new Map(packageLinks.map((link) => [link.id, link]));
  for (const ids of chunks(packageEventIds)) {
    const rows = await fetchAllPages(() => db.from("forge_work_links")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("relationship_type", "cost_attributed")
      .eq("source_domain", "financial")
      .eq("source_type", "financial_event")
      .eq("target_domain", "workmgmt")
      .eq("target_type", "work_package")
      .in("source_id", ids)
      .order("source_id", { ascending: true })
      .order("target_id", { ascending: true })
      .order("id", { ascending: true }));
    for (const row of rows) {
      if (!linksById.has(row.id)) linksById.set(row.id, row);
    }
  }
  const links = [...linksById.values()];

  const events = [];
  for (const ids of chunks(packageEventIds)) {
    const rows = await fetchAllPages(() => db.from("financial_events")
      .select(EVENT_COLUMNS)
      .eq("owner_id", ownerId)
      .in("id", ids)
      .order("id", { ascending: true }));
    events.push(...rows);
  }

  const contractorPaymentIds = [...new Set(
    events.map((event) => contractorPaymentIdOf(event)).filter(Boolean),
  )].sort();
  const contractorPayments = [];
  for (const ids of chunks(contractorPaymentIds)) {
    const rows = await fetchAllPages(() => db.from("rental_contractor_payments")
      .select("id, owner_id, contractor_id, work_order_id, property_id, paid_at, amount_cents, payment_method, reference, invoice_reference, notes")
      .eq("owner_id", ownerId)
      .in("id", ids)
      .order("id", { ascending: true }));
    contractorPayments.push(...rows);
  }

  const { data: budgetRevisions, error: revisionsError } = await db
    .from("forge_work_package_budget_revisions")
    .select("id, package_id, actor, at, old_planned_cost_cents, new_planned_cost_cents, reason")
    .eq("owner_id", ownerId)
    .eq("package_id", packageId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (revisionsError) throw revisionsError;

  const planned = normalizePlannedCostCents(pkg.planned_cost_cents);
  const summary = buildPackageCostSummary({
    package: {
      ...pkg,
      planned_cost_cents: planned.ok ? planned.cents : pkg.planned_cost_cents,
    },
    ownerId,
    links,
    events,
    contractorPayments,
    unitIds,
  });

  return {
    ok: true,
    summary: {
      ...summary,
      packageStatus: pkg.status,
      packageVersion: pkg.version ?? null,
      packageUpdatedAt: pkg.updated_at || null,
      budgetRevisions: (budgetRevisions || []).map((revision) => ({
        ...revision,
        old_planned_cost_cents: normalizePlannedCostCents(revision.old_planned_cost_cents).cents,
        new_planned_cost_cents: normalizePlannedCostCents(revision.new_planned_cost_cents).cents,
      })),
    },
  };
}
