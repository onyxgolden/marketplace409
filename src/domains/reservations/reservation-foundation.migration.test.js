import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260901000100_create_reservation_inventory_foundation.sql"), "utf8");

describe("reservation inventory migration", () => {
  it("keeps physical inventory attached to Rental Manager units", () => {
    expect(sql).toContain("references rental_units(owner_id, id)");
    expect(sql).toContain("'rv_site'");
    expect(sql).not.toMatch(/mileage|fuel|vin|drivable/i);
  });

  it("uses workspace-scoped RLS and exposes nothing to anonymous guests", () => {
    expect(sql.match(/has_workspace_access\(owner_id\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql).not.toMatch(/grant .* to anon/i);
    expect(sql).toContain("force row level security");
  });

  it("supports nightly, weekly, and monthly rates plus calendar blocks", () => {
    expect(sql).toContain("'nightly','weekly','monthly'");
    expect(sql).toContain("reservation_calendar_blocks");
    expect(sql).toContain("'owner_hold','maintenance','turnover','external_booking','other'");
  });
});
