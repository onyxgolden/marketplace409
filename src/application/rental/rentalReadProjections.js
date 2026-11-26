// Slice 1 (Rental Partial Open) — surface-specific read projections.
//
// GET /api/rental?surface=summary|tenants|tenant-detail serves only the
// columns and rows the named surface actually draws. The legacy full payload
// (GET /api/rental with no surface) is untouched and stays the path for the
// surfaces this slice does not cover; it must never run in parallel "just in
// case" when a projection succeeds.
//
// Rules every projection follows:
// - Authenticate + resolve the effective workspace BEFORE interpreting an id
//   (the route does this; these handlers only ever see `authenticated`).
// - Explicit column lists. No select("*") anywhere in a Slice-1 path.
// - Display values, order and totals exactly as the monolith produced them:
//   the projections return the same rows the same builders/panels read, only
//   narrower. No formula changes, no lookback caps, no new totals.
// - collectionSummary is NOT shipped by any projection: nothing in
//   buildRentalDashboardSummary or any panel reads it (verified by grep —
//   only route.js computes it). The Summary builder reads its balances from
//   /api/rental/reports, exactly as before.
// - Work orders carry no title/priority/submitted_at/unit_id columns (see
//   supabase/migrations/20260813002600_create_rental_maintenance_work_orders.sql),
//   so the Summary projection maps them to the exact fallback shape the
//   builder already produced for them (title/priority/submitted_at/unit_id
//   null) instead of inventing values from created_at/scope_of_work.
import { NextResponse } from "next/server";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";

export const RENTAL_SURFACES = Object.freeze(["summary", "tenants", "tenant-detail"]);

// Tenants index: only the compact fields the list columns draw (name, email,
// invite state, portal claim, thumbnail) — the full profile lives in the
// tenant-detail projection, never in the list.
export const TENANT_LIST_COLUMNS =
  "id, display_name, email, invited_at, auth_user_id, photo_bucket, photo_object_path";

// Tenant detail: the exact 24 columns the monolith selected for rental_tenants
// (the record page renders the full profile form for the primary tenant and
// every co-tenant, so co-tenants need full rows too — a compact row would
// render empty profile fields).
export const TENANT_DETAIL_COLUMNS =
  "id, display_name, email, phone, work_phone, employer_name, employer_phone, monthly_income_cents, "
  + "emergency_contact_name, emergency_contact_phone, application_status, application_submitted_at, "
  + "screening_provider, screening_reference, screening_status, screening_completed_at, ssn_last_four, "
  + "landlord_notes, status, invited_at, auth_user_id, payment_policy, photo_bucket, photo_object_path";

export const TENANT_LIST_PAGE_SIZE = 50;

// Bounded co-tenant lookup: how many name/email matches one search returns.
// The list page stays 50; a lookup is a targeted candidate search, not a page.
export const TENANT_LOOKUP_PAGE_SIZE = 20;

const OPEN_CHARGE_STATUSES = ["scheduled", "due", "partially_paid", "overdue"];

// Escape a user search term for a PostgREST ilike() pattern: a raw %, _ or
// backslash would widen the match, and a raw comma would split the or()
// term list. The mock query chain in route.surface.test.js undoes the same
// escapes, so the guard proves the pattern that actually reaches the server.
function escapeIlikePattern(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, "\\,");
}

// The exact financial-event columns the Summary builders read
// (buildRentalDashboardSummary + buildRentalPropertyPerformance /
// buildRentalFinancialPerformance). Full history, uncapped — the portfolio
// chart needs complete per-property parity.
const SUMMARY_FINANCIAL_EVENT_COLUMNS =
  "event_date, amount, transaction_kind, source_system, status, is_deleted, business_scope, property_id, normalized_category, affects_noi, capitalized";

// Mirrors withPhotoUrls in src/app/api/rental/route.js: signs only the records
// handed in (the caller decides the subset) and leaves photo_url null when a
// record has no stored photo or signing fails.
async function signRecordPhotos(supabaseClient, records) {
  return Promise.all((records || []).map(async (record) => {
    if (!record.photo_bucket || !record.photo_object_path) return { ...record, photo_url: null };
    const { data, error } = await supabaseClient.storage.from(record.photo_bucket)
      .createSignedUrl(record.photo_object_path, 3600);
    return { ...record, photo_url: error ? null : data.signedUrl };
  }));
}

// Which units the Summary builder actually shows a photo for: the first 8 in
// label order (portfolio strip) plus the first 6 vacant in label order
// (vacant-unit details). Every other unit's photo_url is never read by the
// builder, so signing only this union preserves the built summary exactly
// while skipping per-record signing for the rest.
export function summaryPhotoRecordIds(units, leases) {
  const occupiedUnitIds = new Set(
    (leases || []).filter((lease) => lease.status === "active").map((lease) => lease.unit_id).filter(Boolean),
  );
  const vacantUnits = (units || []).filter((unit) => !occupiedUnitIds.has(unit.id));
  return new Set([...(units || []).slice(0, 8), ...vacantUnits.slice(0, 6)].map((unit) => unit.id));
}

function throwIfError(...results) {
  const error = results.map((result) => result?.error).find(Boolean);
  if (error) throw error;
}

// Work orders have no title/priority/submitted_at/unit_id: map them to the
// builder's fallback shape (nulls read exactly as the monolith's undefineds
// did — `item.title || "Maintenance request"`, priority weight 1, epoch sort,
// null unit label).
export function mapWorkOrderToMaintenanceQueueItem(workOrder) {
  return {
    id: workOrder.id,
    title: null,
    priority: null,
    status: workOrder.status,
    submitted_at: null,
    unit_id: null,
  };
}

export async function getSummaryProjection({ supabaseClient, effectiveOwnerId, user }) {
  const [
    unitsResult, leasesResult, paymentsResult, settlementsResult,
    maintenanceRequestsResult, workOrdersResult, insurancePoliciesResult,
    depositsResult, inspectionsResult, supportCasesResult, schedulesResult,
    billingSettingsResult, propertyFinancialSetupsResult, financialEventsResult,
  ] = await Promise.all([
    supabaseClient.from("rental_units")
      .select("id, property_id, label, photo_bucket, photo_object_path").order("label", { ascending: true }),
    supabaseClient.from("rental_leases")
      .select("id, unit_id, status, end_date").order("start_date", { ascending: false }),
    supabaseClient.from("rental_payments")
      .select("id, status, succeeded_at, received_at, created_at, amount_cents, refunded_amount_cents, deposit_state")
      .order("created_at", { ascending: false }),
    supabaseClient.from("rental_settlements")
      .select("payment_id, status").order("created_at", { ascending: false }),
    supabaseClient.from("rental_maintenance_requests")
      .select("id, title, priority, status, submitted_at, unit_id").order("submitted_at", { ascending: false }),
    supabaseClient.from("rental_maintenance_work_orders")
      .select("id, status, created_at").order("created_at", { ascending: false }),
    supabaseClient.from("renters_insurance_policies")
      .select("lease_id, status").order("expiration_date", { ascending: true }),
    supabaseClient.from("rental_security_deposits")
      .select("lease_id").order("created_at", { ascending: false }),
    supabaseClient.from("rental_inspections")
      .select("lease_id, inspection_type, status").order("inspection_date", { ascending: false }),
    supabaseClient.from("rental_support_cases")
      .select("id, status").order("opened_at", { ascending: false }),
    supabaseClient.from("rent_schedules")
      .select("collection_mode").order("effective_start_date", { ascending: false }),
    supabaseClient.from("rental_billing_settings")
      .select("billing_enabled").eq("owner_id", effectiveOwnerId).maybeSingle(),
    supabaseClient.from("property_financial_setups")
      .select("property_id, purchase_date, purchase_price_cents, down_payment_cents, closing_costs_cents")
      .eq("owner_id", effectiveOwnerId).order("property_id", { ascending: true }),
    fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, { columns: SUMMARY_FINANCIAL_EVENT_COLUMNS })
      .then((data) => ({ data, error: null })).catch((caught) => ({ data: null, error: caught })),
  ]);
  throwIfError(unitsResult, leasesResult, paymentsResult, settlementsResult,
    maintenanceRequestsResult, workOrdersResult, insurancePoliciesResult,
    depositsResult, inspectionsResult, supportCasesResult, schedulesResult,
    billingSettingsResult, propertyFinancialSetupsResult, financialEventsResult);
  const units = unitsResult.data || [];
  const leases = leasesResult.data || [];
  const photoIds = summaryPhotoRecordIds(units, leases);
  const signedUnits = await signRecordPhotos(supabaseClient, units.filter((unit) => photoIds.has(unit.id)));
  const photoById = new Map(signedUnits.map((unit) => [unit.id, unit.photo_url]));
  return {
    success: true,
    surface: "summary",
    actingUserId: user?.id ?? null,
    canonicalOwnerId: effectiveOwnerId,
    units: units.map((unit) => (photoIds.has(unit.id) ? { ...unit, photo_url: photoById.get(unit.id) ?? null } : { ...unit, photo_url: null })),
    leases,
    payments: paymentsResult.data || [],
    settlements: settlementsResult.data || [],
    maintenanceRequests: maintenanceRequestsResult.data || [],
    workOrders: (workOrdersResult.data || []).map(mapWorkOrderToMaintenanceQueueItem),
    insurancePolicies: insurancePoliciesResult.data || [],
    deposits: depositsResult.data || [],
    inspections: inspectionsResult.data || [],
    supportCases: supportCasesResult.data || [],
    schedules: schedulesResult.data || [],
    billingEnabled: billingSettingsResult.data?.billing_enabled === true,
    propertyFinancialSetups: propertyFinancialSetupsResult.data || [],
    financialEvents: financialEventsResult.data || [],
  };
}

export async function getTenantsProjection({ supabaseClient }, { page = 1, pageSize = TENANT_LIST_PAGE_SIZE, search = null } = {}) {
  // A missing param arrives as null: Number(null) is 0, NOT NaN, so a naive
  // Number() check would silently clamp the page size to 1. Treat
  // null/undefined/"" as "use the default" before any numeric coercion.
  const safePositiveInt = (value, fallback, max) => {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(1, parsed));
  };
  const trimmedSearch = typeof search === "string" ? search.trim() : "";
  if (trimmedSearch) {
    // Bounded targeted lookup (PR #863 fix round 1, Finding 2): the
    // co-tenant picker must reach tenants sorted past page 1. Matches on
    // display_name or email, display_name order with an id tie-break, at
    // most 20 rows. The join rows the index draws are not needed for a
    // candidate lookup, so they are not fetched — the response carries
    // empty joins, never stale ones.
    const pattern = escapeIlikePattern(trimmedSearch);
    const lookupResult = await supabaseClient.from("rental_tenants")
      .select(TENANT_LIST_COLUMNS, { count: "exact" })
      .or(`display_name.ilike.%${pattern}%,email.ilike.%${pattern}%`)
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(TENANT_LOOKUP_PAGE_SIZE);
    throwIfError(lookupResult);
    const tenants = await signRecordPhotos(supabaseClient, lookupResult.data || []);
    return {
      success: true,
      surface: "tenants",
      tenants,
      leaseMemberships: [],
      leases: [],
      units: [],
      openCharges: [],
      totalCount: lookupResult.count ?? tenants.length,
      page: 1,
      pageSize: TENANT_LOOKUP_PAGE_SIZE,
      search: trimmedSearch,
    };
  }
  const safePage = safePositiveInt(page, 1, Number.MAX_SAFE_INTEGER);
  const safePageSize = safePositiveInt(pageSize, TENANT_LIST_PAGE_SIZE, TENANT_LIST_PAGE_SIZE);
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const [tenantsResult, membershipsResult, leasesResult, unitsResult, openChargesResult] = await Promise.all([
    supabaseClient.from("rental_tenants")
      .select(TENANT_LIST_COLUMNS, { count: "exact" })
      .order("display_name", { ascending: true })
      // Fix round 2, residual P2: the id tie-break makes the page order
      // deterministic in the database -- two tenants sharing a display name
      // at ranks 50/51 must land on their own pages in a stable sequence,
      // never duplicate or omit across page requests.
      .order("id", { ascending: true })
      .range(from, to),
    supabaseClient.from("rental_lease_tenants")
      .select("lease_id, tenant_id, occupancy_role").order("lease_id", { ascending: true }),
    supabaseClient.from("rental_leases")
      .select("id, unit_id, status").order("start_date", { ascending: false }),
    supabaseClient.from("rental_units")
      .select("id, label").order("label", { ascending: true }),
    supabaseClient.from("rent_charges")
      .select("id, lease_id, amount_cents, paid_amount_cents").in("status", OPEN_CHARGE_STATUSES)
      .order("due_date", { ascending: true }),
  ]);
  throwIfError(tenantsResult, membershipsResult, leasesResult, unitsResult, openChargesResult);
  const tenants = await signRecordPhotos(supabaseClient, tenantsResult.data || []);
  return {
    success: true,
    surface: "tenants",
    tenants,
    leaseMemberships: membershipsResult.data || [],
    leases: leasesResult.data || [],
    units: unitsResult.data || [],
    openCharges: openChargesResult.data || [],
    totalCount: tenantsResult.count ?? tenants.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

export async function getTenantDetailProjection({ supabaseClient, effectiveOwnerId }, tenantId) {
  const trimmedId = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!trimmedId) return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  // Owner-scoped lookup: a tenant from another workspace resolves to 404,
  // never a 403 that would leak its existence (same rule as the tenant-ledger
  // endpoint and the delete/invite actions).
  const tenantResult = await supabaseClient.from("rental_tenants")
    .select(TENANT_DETAIL_COLUMNS).eq("owner_id", effectiveOwnerId).eq("id", trimmedId).maybeSingle();
  if (tenantResult.error) throw tenantResult.error;
  if (!tenantResult.data) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
  const tenant = tenantResult.data;
  const membershipsResult = await supabaseClient.from("rental_lease_tenants")
    .select("lease_id, tenant_id, occupancy_role").eq("tenant_id", trimmedId).order("lease_id", { ascending: true });
  throwIfError(membershipsResult);
  const leaseIds = [...new Set((membershipsResult.data || []).map((item) => item.lease_id).filter(Boolean))];
  const [leasesResult, householdMembershipsResult, overrideResult, billingSettingsResult] = await Promise.all([
    leaseIds.length
      ? supabaseClient.from("rental_leases")
        .select("id, unit_id, property_id, status, start_date, end_date, monthly_rent_cents").in("id", leaseIds)
        .order("start_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    leaseIds.length
      ? supabaseClient.from("rental_lease_tenants")
        .select("lease_id, tenant_id, occupancy_role").in("lease_id", leaseIds).order("lease_id", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabaseClient.from("rental_late_fee_tenant_overrides")
      .select("tenant_id, exempt, grace_days, calculation_type, fixed_amount_cents, percentage_basis_points, maximum_amount_cents, updated_at")
      .eq("owner_id", effectiveOwnerId).eq("tenant_id", trimmedId).maybeSingle(),
    supabaseClient.from("rental_billing_settings")
      .select("payment_policy").eq("owner_id", effectiveOwnerId).maybeSingle(),
  ]);
  throwIfError(leasesResult, householdMembershipsResult, overrideResult, billingSettingsResult);
  const leases = leasesResult.data || [];
  const householdMemberships = householdMembershipsResult.data || [];
  const householdTenantIds = [...new Set(householdMemberships.map((item) => item.tenant_id).filter(Boolean))];
  if (!householdTenantIds.includes(trimmedId)) householdTenantIds.push(trimmedId);
  const [householdTenantsResult, unitsResult, openChargesResult] = await Promise.all([
    supabaseClient.from("rental_tenants")
      .select(TENANT_DETAIL_COLUMNS).eq("owner_id", effectiveOwnerId).in("id", householdTenantIds)
      .order("display_name", { ascending: true }),
    leases.length
      ? supabaseClient.from("rental_units")
        .select("id, label").in("id", [...new Set(leases.map((lease) => lease.unit_id).filter(Boolean))])
        .order("label", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    leaseIds.length
      ? supabaseClient.from("rent_charges")
        .select("id, lease_id, amount_cents, paid_amount_cents").in("lease_id", leaseIds).in("status", OPEN_CHARGE_STATUSES)
        .order("due_date", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfError(householdTenantsResult, unitsResult, openChargesResult);
  const householdTenants = await signRecordPhotos(supabaseClient, householdTenantsResult.data || []);
  return {
    success: true,
    surface: "tenant-detail",
    tenant: householdTenants.find((item) => item.id === trimmedId) || tenant,
    tenants: householdTenants,
    leases,
    leaseMemberships: householdMemberships,
    units: unitsResult.data || [],
    openCharges: openChargesResult.data || [],
    lateFeeTenantOverride: overrideResult.data || null,
    paymentPolicy: billingSettingsResult.data?.payment_policy || "allow_any_amount",
  };
}

// Route dispatch for GET /api/rental?surface=... — returns a NextResponse for
// the three Slice-1 surfaces, or null when no (known) surface was requested
// so the caller falls through to the legacy full payload. An unknown surface
// value is a client bug: 400, never a silent full payload.
export async function getRentalSurfaceProjection({ authenticated, surface, searchParams }) {
  const { supabaseClient, effectiveOwnerId, user } = authenticated;
  if (surface === "summary") {
    return NextResponse.json(await getSummaryProjection({ supabaseClient, effectiveOwnerId, user }));
  }
  if (surface === "tenants") {
    return NextResponse.json(await getTenantsProjection({ supabaseClient }, {
      page: searchParams?.get("page"),
      pageSize: searchParams?.get("pageSize"),
      search: searchParams?.get("search"),
    }));
  }
  if (surface === "tenant-detail") {
    const result = await getTenantDetailProjection({ supabaseClient, effectiveOwnerId }, searchParams?.get("tenantId"));
    return result instanceof NextResponse ? result : NextResponse.json(result);
  }
  if (surface !== null && surface !== undefined) {
    return NextResponse.json({ error: "Unknown rental surface." }, { status: 400 });
  }
  return null;
}
