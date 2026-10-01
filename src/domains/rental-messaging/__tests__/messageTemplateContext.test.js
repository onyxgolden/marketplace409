import { describe, expect, it } from "vitest";
import { resolveWorkOrderTemplateContext } from "../messageTemplateContext";

// Minimal chainable supabase stub: from(table) -> select/eq/not/order/limit ->
// maybeSingle() or direct await (thenable). Rows are filtered in memory.
function mockSupabase(rowsByTable) {
  return {
    from(table) {
      const rows = rowsByTable[table] || [];
      const filters = [];
      const state = {};
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        not(column, operator, value) {
          if (operator === "in") {
            const excluded = new Set(String(value).replace(/[()]/g, "").split(","));
            filters.push((row) => !excluded.has(String(row[column])));
          }
          return query;
        },
        order(column, { ascending }) { state.order = { column, ascending }; return query; },
        limit(count) { state.limit = count; return query; },
        async maybeSingle() {
          const matches = apply();
          return { data: matches[0] || null, error: null };
        },
        then(resolve) { resolve({ data: apply(), error: null }); },
      };
      function apply() {
        let out = rows.filter((row) => filters.every((test) => test(row)));
        if (state.order) {
          const { column, ascending } = state.order;
          out = [...out].sort((a, b) => (ascending
            ? String(a[column]).localeCompare(String(b[column]))
            : String(b[column]).localeCompare(String(a[column]))));
        }
        if (state.limit) out = out.slice(0, state.limit);
        return out;
      }
      return query;
    },
  };
}

const BASE_ROWS = {
  rental_maintenance_work_orders: [
    { owner_id: "owner_1", id: "wo_1", request_id: "req_1", contractor_id: "con_1", scope_of_work: "Replace the kitchen faucet", scheduled_start: "2026-10-02T14:00:00Z" },
  ],
  rental_maintenance_requests: [
    { owner_id: "owner_1", id: "req_1", lease_id: "lease_1", tenant_id: "ten_1", title: "Faucet leak" },
  ],
  rental_contractors: [
    { owner_id: "owner_1", id: "con_1", business_name: "Acme Plumbing" },
  ],
  rental_tenants: [
    { owner_id: "owner_1", id: "ten_1", display_name: "Eric Carrillo" },
  ],
  rent_charges: [
    { owner_id: "owner_1", lease_id: "lease_1", due_date: "2026-10-01", amount_cents: 160000, paid_amount_cents: 0, status: "due" },
    { owner_id: "owner_1", lease_id: "lease_1", due_date: "2026-11-01", amount_cents: 160000, paid_amount_cents: 84500, status: "partially_paid" },
    { owner_id: "owner_1", lease_id: "lease_1", due_date: "2026-09-01", amount_cents: 160000, paid_amount_cents: 160000, status: "paid" },
  ],
  rental_leases: [{ owner_id: "owner_1", id: "lease_1", property_id: "308-paula", unit_id: "unit_1" }],
  rental_units: [{ owner_id: "owner_1", id: "unit_1", label: "308 Paula — Unit A" }],
  rental_email_settings: [{ owner_id: "owner_1", sender_name: "Brandy Morgan" }],
};

describe("resolveWorkOrderTemplateContext", () => {
  it("resolves the full field map for a work order", async () => {
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: mockSupabase(BASE_ROWS),
      ownerId: "owner_1",
      workOrderId: "wo_1",
    });
    expect(fields).toMatchObject({
      tenant_name: "Eric Carrillo",
      property_label: "308 Paula — Unit A",
      balance_due: "$2,355.00",
      rent_due_date: "Oct 1, 2026",
      owner_name: "Brandy Morgan",
      work_order_scope: "Replace the kitchen faucet",
      contractor_name: "Acme Plumbing",
      scheduled_date: "Oct 2, 2026",
    });
  });

  it("humanizes the property slug when the lease names no unit", async () => {
    const rows = {
      ...BASE_ROWS,
      rental_leases: [{ owner_id: "owner_1", id: "lease_1", property_id: "308-paula", unit_id: null }],
    };
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: mockSupabase(rows),
      ownerId: "owner_1",
      workOrderId: "wo_1",
    });
    expect(fields.property_label).toBe("308 Paula");
  });

  it("falls back to the lease-tenant link when the request names no tenant", async () => {
    const rows = {
      ...BASE_ROWS,
      rental_maintenance_requests: [{ owner_id: "owner_1", id: "req_1", lease_id: "lease_1", tenant_id: null, title: "Faucet leak" }],
      rental_lease_tenants: [{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "ten_1" }],
    };
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: mockSupabase(rows),
      ownerId: "owner_1",
      workOrderId: "wo_1",
    });
    expect(fields.tenant_name).toBe("Eric Carrillo");
  });

  it("returns an empty map for an unknown work order", async () => {
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: mockSupabase(BASE_ROWS),
      ownerId: "owner_1",
      workOrderId: "wo_missing",
    });
    expect(fields).toEqual({});
  });

  it("resolves what it can when the lease link is missing", async () => {
    const rows = {
      ...BASE_ROWS,
      rental_maintenance_requests: [{ owner_id: "owner_1", id: "req_1", lease_id: null, tenant_id: null, title: "Faucet leak" }],
    };
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: mockSupabase(rows),
      ownerId: "owner_1",
      workOrderId: "wo_1",
    });
    expect(fields.work_order_scope).toBe("Replace the kitchen faucet");
    expect(fields.contractor_name).toBe("Acme Plumbing");
    expect(fields.owner_name).toBe("Brandy Morgan");
    expect(fields.tenant_name).toBeUndefined();
    expect(fields.balance_due).toBeUndefined();
    expect(fields.property_label).toBeUndefined();
  });

  it("never throws when a lookup fails mid-chain", async () => {
    const failing = mockSupabase(BASE_ROWS);
    failing.from = () => { throw new Error("db down"); };
    const fields = await resolveWorkOrderTemplateContext({
      supabaseClient: failing,
      ownerId: "owner_1",
      workOrderId: "wo_1",
    });
    expect(fields).toEqual({});
  });
});
