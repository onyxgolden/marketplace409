// Slice 1 (Rental Partial Open) — route-level projection guard.
//
// Proves, by counting actual route/table calls against a recording mock
// client (not by snapshotting source text):
//   1. Summary/Tenants/detail invoke ONLY their projection's tables — no
//      legacy full projection, no unrelated section query.
//   2. The tenant list returns at most 50 rows for page 1, carries the total
//      count, keeps display_name order, and uses no select("*").
//   3. Tenant detail is owner-scoped (foreign/missing id -> 404, never 403).
//   4. An unknown surface is a 400, never a silent full payload.
//   5. No surface param still serves the legacy monolith (untouched surfaces).
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "owner_1";

// Fixture rows per table. Tenants are deliberately out of order so the test
// proves the server orders by display_name; 60 rows prove the 50-row cap.
function makeTenants(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `tenant_${String(count - i).padStart(2, "0")}`,
    owner_id: OWNER_ID,
    display_name: `Tenant ${String(count - i).padStart(2, "0")}`,
    email: `tenant${count - i}@example.com`,
    phone: null, work_phone: null, employer_name: null, employer_phone: null,
    monthly_income_cents: null, emergency_contact_name: null, emergency_contact_phone: null,
    application_status: null, application_submitted_at: null, screening_provider: null,
    screening_reference: null, screening_status: null, screening_completed_at: null,
    ssn_last_four: null, landlord_notes: null, status: "inactive",
    invited_at: null, auth_user_id: null, payment_policy: null,
    photo_bucket: null, photo_object_path: null,
  }));
}
const FIXTURES = {
  rental_units: [
    { id: "unit_1", property_id: "prop_a", label: "101 Main St", status: "occupied", photo_bucket: "rental-photos", photo_object_path: "u1.jpg" },
    { id: "unit_2", property_id: "prop_a", label: "102 Main St", status: "available", photo_bucket: null, photo_object_path: null },
  ],
  rental_tenants: makeTenants(60),
  rent_schedules: [{ id: "sch_1", collection_mode: "forge" }, { id: "sch_2", collection_mode: "external" }],
  rental_maintenance_requests: [
    { id: "mr_1", title: "Leak", priority: "urgent", status: "open", submitted_at: "2026-11-20T09:00:00Z", unit_id: "unit_1" },
  ],
  rental_notification_outbox: [{ id: "note_1" }],
  rental_payments: [
    { id: "pay_1", status: "succeeded", succeeded_at: "2026-11-02T10:00:00Z", received_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z", amount_cents: 160000, refunded_amount_cents: 0, deposit_state: "deposited" },
  ],
  rental_settlements: [{ id: "set_1", payment_id: "pay_1", status: "paid_out" }],
  rental_security_deposits: [{ id: "dep_1", lease_id: "lease_1" }],
  rental_security_deposit_transactions: [{ id: "dtx_1" }],
  rental_inspections: [{ id: "insp_1", lease_id: "lease_1", inspection_type: "move_in", status: "completed" }],
  rental_inspection_items: [{ id: "ii_1" }],
  rental_inspection_acknowledgements: [{ id: "ia_1" }],
  rental_leases: [
    { id: "lease_1", unit_id: "unit_1", property_id: "prop_a", status: "active", start_date: "2026-01-01", end_date: "2026-12-15", monthly_rent_cents: 160000 },
  ],
  rental_lease_tenants: [
    { lease_id: "lease_1", tenant_id: "tenant_01", occupancy_role: "primary" },
  ],
  rental_lease_changes: [{ id: "lc_1" }],
  rental_late_fee_rules: [{ id: "lr_1" }],
  rental_late_fee_assessments: [{ id: "la_1" }],
  rental_billing_settings: [{ owner_id: OWNER_ID, billing_enabled: true, payment_policy: "allow_any_amount", card_convenience_fee_bps: 0 }],
  rental_late_fee_tenant_overrides: [
    { owner_id: OWNER_ID, tenant_id: "tenant_01", exempt: false, grace_days: 3, calculation_type: "fixed", fixed_amount_cents: 5000, percentage_basis_points: null, maximum_amount_cents: null, updated_at: "2026-11-01T00:00:00Z" },
  ],
  rental_contractors: [{ id: "con_1" }],
  rental_maintenance_work_orders: [
    { id: "wo_1", status: "in_progress", created_at: "2026-11-21T08:00:00Z" },
  ],
  rental_maintenance_work_events: [{ id: "we_1" }],
  rental_lease_preparations: [{ id: "lp_1" }],
  rental_lease_preparation_versions: [{ id: "lpv_1" }],
  rental_lease_signatures: [{ id: "ls_1" }],
  rental_autopay_enrollments: [{ id: "ap_1" }],
  renters_insurance_policies: [{ id: "ins_1", lease_id: "lease_1", status: "verified" }],
  renters_insurance_requirements: [{ lease_id: "lease_1", required: true }],
  rental_animals: [{ id: "an_1" }],
  rental_support_cases: [{ id: "sc_1", status: "open" }],
  property_financial_setups: [{ owner_id: OWNER_ID, property_id: "prop_a", purchase_date: "2020-01-01", purchase_price_cents: 14500000, down_payment_cents: 2000000, closing_costs_cents: 500000 }],
  financial_events: [
    { owner_id: OWNER_ID, event_date: "2026-11-01", amount: 160000, transaction_kind: "income", source_system: "forge", status: "posted", is_deleted: false, business_scope: "rental", property_id: "prop_a", normalized_category: "rent", affects_noi: true, capitalized: false },
  ],
  rental_conversations: [{ id: "conv_1" }],
  rental_tenant_credits: [{ id: "cr_1" }],
  rent_charges: [
    { id: "ch_1", lease_id: "lease_1", schedule_id: "sch_1", period: "2026-11", due_date: "2026-11-01", amount_cents: 160000, paid_amount_cents: 0, currency_code: "USD", status: "due", charge_type: "rent", related_charge_id: null },
  ],
};

// Recording chainable query mock: applies eq/in filters, order and range to
// the fixture rows, and records every select string for the guard assertions.
function makeClient(calls) {
  function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(([kind, column, value]) => {
      if (kind === "eq") return row[column] === value;
      if (kind === "in") return value.includes(row[column]);
      // or: [[column, ilike-pattern], ...] — the row passes when any term
      // matches (case-insensitive substring; backslash escapes undone first).
      if (kind === "or") {
        return value.some(([termColumn, pattern]) => String(row[termColumn] ?? "").toLowerCase().includes(pattern.toLowerCase()));
      }
      return true;
    }));
  }
  // Parse a PostgREST or() string of `col.ilike.%pattern%` terms, undoing
  // the backslash escapes the server applies to the search text.
  function parseOrTerms(orString) {
    return String(orString).split(/(?<!\\),/).map((term) => {
      const match = term.match(/^([^.]+)\.ilike\.%(.*)%$/);
      if (!match) throw new Error(`unsupported or() term in mock: ${term}`);
      const pattern = match[2].replace(/\\(.)/g, "$1");
      return [match[1], pattern];
    });
  }
  function project(row, select) {
    if (!select || String(select).trim() === "*") return row;
    const columns = String(select).split(",").map((column) => column.trim()).filter(Boolean);
    const out = {};
    for (const column of columns) out[column] = row[column] ?? null;
    return out;
  }
  function query(table) {
    const rows = FIXTURES[table] || [];
    const state = { table, select: null, filters: [], order: null, range: null };
    const api = {
      select(columns, options) {
        state.select = columns;
        state.countOption = options?.count;
        calls.push({ table, select: columns });
        return api;
      },
      eq(column, value) { state.filters.push(["eq", column, value]); return api; },
      in(column, values) { state.filters.push(["in", column, values]); return api; },
      or(orString) { state.filters.push(["or", null, parseOrTerms(orString)]); return api; },
      order(column, options) { state.order = [column, options?.ascending !== false]; return api; },
      range(from, to) { state.range = [from, to]; return api; },
      limit(count) { state.limit = count; return api; },
      is() { return api; },
      maybeSingle() {
        const filtered = applyFilters(rows, state.filters);
        const row = filtered[0] ?? null;
        return Promise.resolve({ data: row ? project(row, state.select) : null, error: null });
      },
      single() {
        const filtered = applyFilters(rows, state.filters);
        const row = filtered[0] ?? null;
        return Promise.resolve({ data: row ? project(row, state.select) : null, error: null });
      },
      then(resolve) {
        let out = applyFilters(rows, state.filters);
        const total = out.length;
        if (state.order) {
          const [column, ascending] = state.order;
          out = [...out].sort((a, b) => {
            if (a[column] < b[column]) return ascending ? -1 : 1;
            if (a[column] > b[column]) return ascending ? 1 : -1;
            return 0;
          });
        }
        if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
        if (state.limit != null) out = out.slice(0, state.limit);
        resolve({ data: out.map((row) => project(row, state.select)), error: null, count: total });
        return undefined;
      },
    };
    return api;
  }
  return {
    from: (table) => query(table),
    storage: { from: () => ({ createSignedUrl: async (path) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }) }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

const application = { units: { findById: vi.fn() }, findUnitsByProperty: vi.fn(), saveUnit: vi.fn(), saveTenant: vi.fn(), saveLease: vi.fn(), saveSchedule: vi.fn(), generateMonthlyCharge: vi.fn() };
let calls;
let supabaseClient;
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    application, user: { id: OWNER_ID }, effectiveOwnerId: OWNER_ID, supabaseClient,
  })),
}));
import { GET } from "./route.js";

function get(url) {
  return GET(new Request(`http://localhost${url}`));
}
function tablesCalled() {
  return [...new Set(calls.map((call) => call.table))];
}
function selectStrings() {
  return calls.map((call) => call.select);
}

describe("GET /api/rental surface projections", () => {
  beforeEach(() => {
    calls = [];
    supabaseClient = makeClient(calls);
    vi.clearAllMocks();
  });

  it("summary reads only its 14 projection tables, with explicit columns and no select(*)", async () => {
    const response = await get("/api/rental?surface=summary");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.surface).toBe("summary");
    expect(body).not.toHaveProperty("collectionSummary");
    expect(body.billingEnabled).toBe(true);
    expect(body.units).toHaveLength(2);
    expect(body.financialEvents).toHaveLength(1);
    // Guard 1: no unrelated section query (no notifications, leases-changes,
    // contractors, conversations, credits, animals, autopay, preparations...).
    expect(tablesCalled().sort()).toEqual([
      "financial_events", "property_financial_setups", "rent_schedules",
      "rental_billing_settings", "rental_inspections", "rental_leases",
      "rental_maintenance_requests", "rental_maintenance_work_orders",
      "rental_payments", "rental_security_deposits", "rental_settlements",
      "rental_support_cases", "rental_units", "renters_insurance_policies",
    ].sort());
    // Guard 2 (columns): no select("*") in any Slice-1 path.
    expect(selectStrings().every((select) => !String(select).includes("*"))).toBe(true);
    // Guard 6 (columns): every column the Summary builder reads must be in the
    // projection -- dropping one (e.g. payments.amount_cents) changes a
    // displayed figure against the golden ledger. Exact strings, not subsets.
    const selectsByTable = {};
    for (const call of calls) selectsByTable[call.table] = call.select;
    expect(selectsByTable).toEqual({
      rental_units: "id, property_id, label, photo_bucket, photo_object_path",
      rental_leases: "id, unit_id, status, end_date",
      rental_payments: "id, status, succeeded_at, received_at, created_at, amount_cents, refunded_amount_cents, deposit_state",
      rental_settlements: "payment_id, status",
      rental_maintenance_requests: "id, title, priority, status, submitted_at, unit_id",
      rental_maintenance_work_orders: "id, status, created_at",
      renters_insurance_policies: "lease_id, status",
      rental_security_deposits: "lease_id",
      rental_inspections: "lease_id, inspection_type, status",
      rental_support_cases: "id, status",
      rent_schedules: "collection_mode",
      rental_billing_settings: "billing_enabled",
      property_financial_setups: "property_id, purchase_date, purchase_price_cents, down_payment_cents, closing_costs_cents",
      financial_events: "event_date, amount, transaction_kind, source_system, status, is_deleted, business_scope, property_id, normalized_category, affects_noi, capitalized",
    });
    // Work orders arrive in the builder's fallback shape.
    expect(body.workOrders).toEqual([{ id: "wo_1", title: null, priority: null, status: "in_progress", submitted_at: null, unit_id: null }]);
    // Only the portfolio-strip/vacant union gets a signed photo URL.
    expect(body.units.find((unit) => unit.id === "unit_1").photo_url).toBe("https://signed/u1.jpg");
    expect(body.units.find((unit) => unit.id === "unit_2").photo_url).toBeNull();
  });

  it("tenants returns at most 50 rows for page 1, with total count, display_name order, and no select(*)", async () => {
    const response = await get("/api/rental?surface=tenants");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.surface).toBe("tenants");
    expect(body.tenants).toHaveLength(50);
    expect(body.totalCount).toBe(60);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.tenants.map((tenant) => tenant.display_name)).toEqual(
      Array.from({ length: 50 }, (_, i) => `Tenant ${String(i + 1).padStart(2, "0")}`),
    );
    expect(tablesCalled().sort()).toEqual([
      "rent_charges", "rental_leases", "rental_lease_tenants", "rental_tenants", "rental_units",
    ].sort());
    expect(selectStrings().every((select) => !String(select).includes("*"))).toBe(true);
    // Guard 6 (columns): the list rows must carry exactly the 7 compact
    // columns -- dropping display_name breaks identity and order.
    const selectsByTable = {};
    for (const call of calls) selectsByTable[call.table] = call.select;
    expect(selectsByTable.rental_tenants).toBe("id, display_name, email, invited_at, auth_user_id, photo_bucket, photo_object_path");
    expect(selectsByTable.rental_leases).toBe("id, unit_id, status");
    expect(selectsByTable.rental_units).toBe("id, label");
    expect(selectsByTable.rent_charges).toBe("id, lease_id, amount_cents, paid_amount_cents");
    // Compact rows: no profile fields leak into the list payload.
    expect(Object.keys(body.tenants[0]).sort()).toEqual([
      "auth_user_id", "display_name", "email", "id", "invited_at",
      "photo_bucket", "photo_object_path", "photo_url",
    ]);
  });

  it("tenants page=2 returns rows 51–60 with no overlap with page 1", async () => {
    const first = await (await get("/api/rental?surface=tenants&page=1")).json();
    const second = await get("/api/rental?surface=tenants&page=2");
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.surface).toBe("tenants");
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(50);
    expect(body.totalCount).toBe(60);
    expect(body.tenants).toHaveLength(10);
    expect(body.tenants.map((tenant) => tenant.display_name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Tenant ${String(i + 51).padStart(2, "0")}`),
    );
    const firstIds = new Set(first.tenants.map((tenant) => tenant.id));
    expect(body.tenants.every((tenant) => !firstIds.has(tenant.id))).toBe(true);
    expect([...firstIds, ...body.tenants.map((tenant) => tenant.id)]).toHaveLength(60);
  });

  it("tenants search returns bounded matches in display_name order and skips the join tables", async () => {
    const response = await get("/api/rental?surface=tenants&search=Tenant%206");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.surface).toBe("tenants");
    expect(body.search).toBe("Tenant 6");
    // Only Tenant 60 matches "Tenant 6" among Tenant 01–60.
    expect(body.tenants.map((tenant) => tenant.display_name)).toEqual(["Tenant 60"]);
    expect(body.totalCount).toBe(1);
    expect(body.pageSize).toBeLessThanOrEqual(20);
    // A candidate lookup needs no join rows: the index joins stay unread.
    expect(tablesCalled()).toEqual(["rental_tenants"]);
    expect(body.leaseMemberships).toEqual([]);
    expect(body.leases).toEqual([]);
    expect(body.units).toEqual([]);
    expect(body.openCharges).toEqual([]);

    // A broad search is bounded to 20 rows even though 60 tenants match.
    const broad = await (await get("/api/rental?surface=tenants&search=Tenant")).json();
    expect(broad.tenants).toHaveLength(20);
    expect(broad.totalCount).toBe(60);
    expect(broad.tenants.map((tenant) => tenant.display_name)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Tenant ${String(i + 1).padStart(2, "0")}`),
    );
    // No match at all: empty rows, zero count, still 200.
    const none = await (await get("/api/rental?surface=tenants&search=zzz-no-such-tenant")).json();
    expect(none.tenants).toEqual([]);
    expect(none.totalCount).toBe(0);
    // A search term cannot widen the match with wildcards.
    const wildcard = await (await get("/api/rental?surface=tenants&search=Tenant%20%25")).json();
    expect(wildcard.totalCount).toBe(0);
  });

  it("tenants projection join counts (Q1 receipt: owner-wide reads behind the 50 rows)", async () => {
    const body = await (await get("/api/rental?surface=tenants")).json();
    // 60 fixture tenants, 1 membership, 1 lease, 2 units, 1 open charge:
    // the index draws the joins in full alongside the 50-row page.
    expect(body.tenants).toHaveLength(50);
    expect(body.leaseMemberships).toHaveLength(1);
    expect(body.leases).toHaveLength(1);
    expect(body.units).toHaveLength(2);
    expect(body.openCharges).toHaveLength(1);
    expect(body.totalCount).toBe(60);
  });

  it("tenant-detail returns the authorized tenant + household and 404s a foreign id", async () => {
    const response = await get("/api/rental?surface=tenant-detail&tenantId=tenant_01");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.surface).toBe("tenant-detail");
    expect(body.tenant.id).toBe("tenant_01");
    expect(body.tenant.display_name).toBe("Tenant 01");
    expect(body.tenants.map((tenant) => tenant.id)).toContain("tenant_01");
    expect(body.leases.map((lease) => lease.id)).toEqual(["lease_1"]);
    expect(body.lateFeeTenantOverride?.grace_days).toBe(3);
    expect(body.paymentPolicy).toBe("allow_any_amount");
    expect(tablesCalled().sort()).toEqual([
      "rent_charges", "rental_billing_settings", "rental_late_fee_tenant_overrides",
      "rental_leases", "rental_lease_tenants", "rental_tenants", "rental_units",
    ].sort());
    expect(selectStrings().every((select) => !String(select).includes("*"))).toBe(true);
    // Guard 6 (columns): the record page renders the full profile form, so the
    // tenant rows must carry all 24 columns -- dropping one empties a profile
    // field against the golden ledger.
    const selectsByTable = {};
    for (const call of calls) selectsByTable[call.table] = call.select;
    expect(selectsByTable.rental_tenants).toBe("id, display_name, email, phone, work_phone, employer_name, employer_phone, monthly_income_cents, emergency_contact_name, emergency_contact_phone, application_status, application_submitted_at, screening_provider, screening_reference, screening_status, screening_completed_at, ssn_last_four, landlord_notes, status, invited_at, auth_user_id, payment_policy, photo_bucket, photo_object_path");
    expect(selectsByTable.rental_leases).toBe("id, unit_id, property_id, status, start_date, end_date, monthly_rent_cents");
    expect(selectsByTable.rent_charges).toBe("id, lease_id, amount_cents, paid_amount_cents");
    expect(selectsByTable.rental_late_fee_tenant_overrides).toBe("tenant_id, exempt, grace_days, calculation_type, fixed_amount_cents, percentage_basis_points, maximum_amount_cents, updated_at");
    expect(selectsByTable.rental_billing_settings).toBe("payment_policy");

    const missing = await get("/api/rental?surface=tenant-detail&tenantId=tenant_99");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("Tenant was not found.");
  });

  it("tenant-detail without an id is a 400, and an unknown surface is a 400", async () => {
    const noId = await get("/api/rental?surface=tenant-detail");
    expect(noId.status).toBe(400);
    const bogus = await get("/api/rental?surface=bogus");
    expect(bogus.status).toBe(400);
    expect((await bogus.json()).error).toBe("Unknown rental surface.");
  });

  it("no surface param still serves the legacy monolith for untouched surfaces", async () => {
    const response = await get("/api/rental");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty("collectionSummary");
    expect(body).toHaveProperty("notifications");
    expect(tablesCalled()).toContain("rental_notification_outbox");
    expect(tablesCalled()).toContain("rental_lease_changes");
  });
});
