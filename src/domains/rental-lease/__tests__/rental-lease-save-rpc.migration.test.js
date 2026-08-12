import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812000200_save_rental_lease.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("save rental lease RPC", () => {
  it("uses caller authority and rejects owner mismatch", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).not.toContain("security definer");
  });
  it("saves the lease and replaces membership atomically", () => {
    expect(sql).toContain("insert into rental_leases");
    expect(sql).toContain("delete from rental_lease_tenants");
    expect(sql).toContain("insert into rental_lease_tenants");
  });
  it("validates every tenant against owner scope", () => {
    expect(sql).toContain("join rental_tenants tenant on tenant.owner_id = p_owner_id");
    expect(sql).toContain("every rental lease tenant must belong to the authenticated owner");
  });
  it("limits execution to authenticated callers", () => {
    expect(sql).toContain("revoke all on function save_rental_lease");
    expect(sql).toContain("grant execute on function save_rental_lease");
    expect(sql).toContain("to authenticated");
  });
});
