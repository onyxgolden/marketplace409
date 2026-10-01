import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Contract test for supabase/migrations/20261001031000_rental_1099_gross_rent_basis.sql
// (R23 CHANGES fix): 1099-MISC Box 1 must aggregate GROSS RENT from the ledger,
// never net owner disbursements. The migration creates the recipient->property
// attribution table that makes the gross-rent basis possible.

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261001031000_rental_1099_gross_rent_basis.sql"),
  "utf8"
);

describe("20261001031000_rental_1099_gross_rent_basis migration contract", () => {
  it("creates the recipient-properties attribution table", () => {
    expect(sql).toContain("create table if not exists rental_1099_recipient_properties");
    expect(sql).toContain("recipient_id text not null");
    expect(sql).toContain("property_id text not null");
  });

  it("references the recipients table with cascade delete", () => {
    expect(sql).toContain("references rental_1099_recipients(owner_id, id)");
    expect(sql).toContain("on delete cascade");
  });

  it("enables RLS with owner-scoped policies", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("has_workspace_access(owner_id)");
  });

  it("documents the gross-rent basis and its exclusions", () => {
    expect(sql).toContain("GROSS RENT");
    expect(sql).toContain("rental_income");
    expect(sql).toContain("disbursement");
  });
});
