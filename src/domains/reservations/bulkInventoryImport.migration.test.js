import fs from "node:fs"; import path from "node:path"; import { describe, expect, it } from "vitest";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260901000300_add_atomic_reservation_inventory_bulk_import.sql"), "utf8");
describe("atomic reservation inventory bulk import migration", () => {
  it("creates units, inventory, rates, and its audit result in one RPC", () => { expect(sql).toContain("insert into rental_units"); expect(sql).toContain("insert into reservation_inventory_settings"); expect(sql).toContain("insert into reservation_rate_plans"); expect(sql).toContain("insert into reservation_inventory_imports"); });
  it("serializes retries and rejects changed plans and existing units", () => { expect(sql).toContain("pg_advisory_xact_lock"); expect(sql).toContain("already used with a different plan"); expect(sql).toContain("already exists"); });
  it("guards workspace access and never grants anonymous or direct import writes", () => { expect(sql).toContain("v_actor is null or not has_workspace_access(p_owner_id)"); expect(sql).toContain("security definer"); expect(sql).not.toMatch(/grant .* to anon/i); expect(sql).not.toMatch(/grant (insert|update|delete) on reservation_inventory_imports/i); });
});
