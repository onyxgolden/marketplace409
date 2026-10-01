import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R19 depreciation-assets
// migration: the table/index are IF NOT EXISTS, policy creation is
// idempotent (drop-if-exists guards every policy so reapplying the migration
// never fails), the workspace-access policy expressions plus forced RLS are
// preserved exactly, and the method/category/invariant CHECKs hold.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001080000_r19_depreciation_assets.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const POLICIES = [
  "rental_depreciation_assets_owner_select",
  "rental_depreciation_assets_owner_insert",
  "rental_depreciation_assets_owner_update",
  "rental_depreciation_assets_owner_delete",
];

describe("r19 depreciation assets migration", () => {
  it("creates the table and index idempotently", () => {
    expect(lower).toContain("create table if not exists rental_depreciation_assets");
    expect(lower).toContain("create index if not exists idx_rental_depreciation_assets_owner_property");
    expect(lower).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
  });

  it("keeps forced workspace-access RLS and the explicit-grant contract", () => {
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    expect(lower).toContain("revoke all on rental_depreciation_assets from anon, authenticated");
    expect(lower).toContain("grant select, insert, update, delete on rental_depreciation_assets to authenticated");
  });

  it("creates each policy idempotently without changing its expression", () => {
    for (const name of POLICIES) {
      const guarded = new RegExp(
        `drop policy if exists "${name}"[\\s\\S]*?create policy "${name}"`,
      );
      expect(guarded.test(lower), `policy ${name} is not created idempotently`).toBe(true);
    }
    for (const name of POLICIES) {
      const body = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      expect(body, `missing policy ${name}`).toBeTruthy();
      expect(body[0]).toContain("has_workspace_access(owner_id)");
      expect(body[0]).toContain("to authenticated");
    }
  });

  it("constrains category, method, and the MACRS life invariants", () => {
    expect(lower).toMatch(/category in\s*\(\s*'building'\s*,\s*'improvement'\s*,\s*'appliance'\s*,\s*'equipment'\s*,\s*'other'\s*\)/);
    expect(lower).toMatch(/method in\s*\(\s*'straight_line'\s*,\s*'macrs_27_5'\s*,\s*'macrs_39'\s*\)/);
    // MACRS methods lock the life to the IRS presets; salvage stays below cost.
    expect(lower).toContain("method = 'macrs_27_5' and useful_life_months = 330");
    expect(lower).toContain("method = 'macrs_39' and useful_life_months = 468");
    expect(lower).toContain("salvage_value_cents < cost_basis_cents");
  });

  it("documents the not-applied, report-only status", () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/i);
    expect(sql).toMatch(/report-only/i);
  });
});
