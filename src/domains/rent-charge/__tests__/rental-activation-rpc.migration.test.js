import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812001400_activate_rental_lease_schedule.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("rental lease and schedule activation RPC", () => {
  it("uses authenticated owner authority", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).not.toContain("security definer");
  });
  it("locks and activates the related lease and schedule atomically", () => {
    expect(sql).toContain("from rent_schedules where owner_id = p_owner_id and id = p_schedule_id for update");
    expect(sql).toContain("from rental_leases where owner_id = p_owner_id and id = schedule.lease_id for update");
    expect(sql).toContain("update rental_leases set status = 'active'");
    expect(sql).toContain("update rent_schedules set status = 'active'");
  });
  it("refuses ended or otherwise ineligible records", () => {
    expect(sql).toContain("lease.status not in ('draft', 'active')");
    expect(sql).toContain("schedule.status not in ('draft', 'active')");
  });
});
