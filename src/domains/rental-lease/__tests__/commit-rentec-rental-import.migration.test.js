import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260816000200_commit_rentec_rental_import.sql"),
  "utf8",
);

describe("commit Rentec rental import migration", () => {
  it("defines the commit function with owner id and three candidate arrays", () => {
    expect(sql).toContain("create or replace function commit_rentec_rental_import(");
    expect(sql).toContain("p_owner_id text");
    expect(sql).toContain("p_units jsonb default '[]'::jsonb");
    expect(sql).toContain("p_tenants jsonb default '[]'::jsonb");
    expect(sql).toContain("p_leases jsonb default '[]'::jsonb");
  });

  it("runs as the caller (security invoker), not a privilege-escalating definer", () => {
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
  });

  it("rejects any owner id that does not match the authenticated caller", () => {
    expect(sql).toContain("p_owner_id <> auth.uid()::text");
  });

  it("caps the number of rows per table in a single commit", () => {
    expect(sql).toMatch(/jsonb_array_length\(p_units\) > 25/);
    expect(sql).toMatch(/jsonb_array_length\(p_tenants\) > 25/);
    expect(sql).toMatch(/jsonb_array_length\(p_leases\) > 25/);
  });

  it.each(["rental_units", "rental_tenants", "rental_leases", "rental_lease_tenants"])(
    "inserts into %s idempotently via the partial unique index, never overwriting",
    (table) => {
      expect(sql).toContain(`insert into ${table}`);
      expect(sql).toMatch(new RegExp(`insert into ${table}[\\s\\S]*?on conflict \\(owner_id, source_system, source_record_id\\)[\\s\\S]*?do nothing`));
    },
  );

  it("does not insert a tenant_id column into rental_leases directly", () => {
    const leasesInsert = sql.match(/insert into rental_leases \(([\s\S]*?)\)/)[1];
    expect(leasesInsert).not.toContain("tenant_id");
  });

  it("always commits leases as draft regardless of the candidate's own status field", () => {
    expect(sql).toMatch(/select\s+p_owner_id, x->>'id', x->>'property_id', x->>'unit_id', 'draft',/);
  });

  it("derives lease/tenant membership from the same lease candidates, not a separate input", () => {
    const membershipInsert = sql.match(/insert into rental_lease_tenants[\s\S]*?from jsonb_array_elements\((\w+)\)/)[1];
    expect(membershipInsert).toBe("p_leases");
  });

  it("is not callable by anonymous or public roles, only authenticated", () => {
    expect(sql).toContain("revoke all on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) from public");
    expect(sql).toContain("revoke all on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) from anon");
    expect(sql).toContain("grant execute on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) to authenticated");
  });
});
