import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260812000100_create_rental_identity.sql"), "utf8");

describe("rental identity migration", () => {
  it.each(["rental_units", "rental_tenants", "rental_leases", "rental_lease_tenants"])(
    "creates and protects %s",
    (table) => {
      expect(sql).toContain(`create table if not exists ${table}`);
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
    },
  );

  it("keeps lease, unit, and tenant relationships owner-scoped", () => {
    expect(sql).toContain("foreign key (owner_id, unit_id) references rental_units(owner_id, id)");
    expect(sql).toContain("foreign key (owner_id, lease_id) references rental_leases(owner_id, id)");
    expect(sql).toContain("foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id)");
  });

  it("allows tenant reads only through authenticated identity and lease membership", () => {
    expect(sql).toContain("auth_user_id = auth.uid()");
    expect(sql).toContain("rental_actor_has_lease_access(owner_id, id)");
    expect(sql).toContain("rental_actor_has_unit_access(owner_id, id)");
  });

  it("keeps all mutations owner-scoped", () => {
    expect(sql.match(/owner_id = auth\.uid\(\)::text/g)?.length).toBeGreaterThanOrEqual(8);
    expect(sql).not.toMatch(/tenant_(insert|update|delete)/);
  });
});
