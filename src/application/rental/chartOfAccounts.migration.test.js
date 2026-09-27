import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20260927140001_chart_of_accounts.sql.
// This test never touches a database: it proves the migration text carries the
// chart-of-accounts contract -- the owner-scoped table with the same RLS shape
// as the other ledger tables, and a seed that inserts the 16 long-standing
// category codes for every owner with ledger activity (so existing
// financial_events.normalized_category values keep resolving).
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260927140001_chart_of_accounts.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("chart of accounts migration — structural contract", () => {
  it("creates chart_of_accounts with the account columns", () => {
    expect(sql).toContain("create table if not exists chart_of_accounts");
    expect(sql).toContain("owner_id text not null");
    expect(sql).toContain("code text not null");
    expect(sql).toContain("label text not null");
    expect(sql).toContain("account_type text not null check (account_type in ('income', 'expense'))");
    expect(sql).toContain("is_active boolean not null default true");
    expect(sql).toContain("is_system boolean not null default false");
    expect(sql).toContain("constraint chart_of_accounts_owner_code_unique unique (owner_id, code)");
  });

  it("gives chart_of_accounts the same owner-scoped RLS shape as the ledger tables", () => {
    expect(sql).toContain("alter table chart_of_accounts enable row level security");
    expect(sql).toContain("alter table chart_of_accounts force row level security");
    expect(sql).toContain("chart_of_accounts_owner_select");
    expect(sql).toContain("chart_of_accounts_owner_insert");
    expect(sql).toContain("chart_of_accounts_owner_update");
    expect(sql).toContain("chart_of_accounts_owner_delete");
    expect(sql).toContain("has_workspace_access(owner_id)");
  });

  it("seeds the 16 long-standing category codes per owner with ledger activity", () => {
    expect(sql).toContain("insert into chart_of_accounts (owner_id, code, label, account_type, is_system)");
    expect(sql).toContain("from financial_events as fe");
    expect(sql).toContain("('rental_income', 'rental income', 'income')");
    expect(sql).toContain("('cam_income', 'cam income', 'income')");
    expect(sql).toContain("('property_repairs', 'repairs', 'expense')");
    expect(sql).toContain("('other', 'other', 'expense')");
    expect(sql).toContain("on conflict (owner_id, code) do nothing");
  });
});
