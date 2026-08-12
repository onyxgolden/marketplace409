import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812001800_create_rental_maintenance_requests.sql"), "utf8").toLowerCase();

describe("rental maintenance migration", () => {
  it("stores owner-scoped requests with lease, unit, and tenant relationships", () => {
    expect(sql).toContain("create table if not exists rental_maintenance_requests");
    expect(sql).toContain("foreign key (owner_id, lease_id) references rental_leases(owner_id, id)");
    expect(sql).toContain("foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id)");
  });
  it("uses a tenant-only submission rpc and keeps owner mutations owner-scoped", () => {
    expect(sql).toContain("create or replace function submit_rental_maintenance_request");
    expect(sql).toContain("tenant.auth_user_id = auth.uid()");
    expect(sql).toContain("lease.status = 'active'");
    expect(sql).toContain("owner_id = auth.uid()::text");
  });
  it("does not grant tenants direct update or delete access", () => {
    expect(sql).toContain('policy "rental_maintenance_tenant_select"');
    expect(sql).not.toContain('policy "rental_maintenance_tenant_update"');
    expect(sql).not.toContain('policy "rental_maintenance_tenant_delete"');
  });
});
