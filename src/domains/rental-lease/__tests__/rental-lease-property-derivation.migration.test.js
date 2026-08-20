import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260819220000_derive_rental_lease_property_from_unit.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("save rental lease RPC — property derived from the selected unit", () => {
  it("derives property_id from the unit's own record instead of trusting client input", () => {
    expect(sql).toContain("create or replace function save_rental_lease");
    expect(sql).toContain("select property_id into resolved_property_id");
    expect(sql).toContain("from rental_units");
    expect(sql).toContain("insert into rental_leases");
    expect(sql).not.toContain("p_lease ->> 'property_id'");
  });

  it("rejects a unit that does not belong to the authenticated owner instead of saving a mismatched lease", () => {
    expect(sql).toContain("if resolved_property_id is null then");
    expect(sql).toContain("raise exception");
  });

  it("still requires caller authority and validates every tenant against owner scope", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain("every rental lease tenant must belong to the authenticated owner");
  });

  it("limits execution to authenticated callers", () => {
    expect(sql).toContain("revoke all on function save_rental_lease");
    expect(sql).toContain("grant execute on function save_rental_lease");
    expect(sql).toContain("to authenticated");
  });
});
