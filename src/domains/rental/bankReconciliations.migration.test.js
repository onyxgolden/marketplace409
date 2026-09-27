import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Static contract checks for the bank_reconciliations migration: reversible
// (no delete, immutable figures), workspace RLS, explicit minimal grants.
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260926200000_create_bank_reconciliations.sql"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("bank_reconciliations migration", () => {
  it("is additive and never deletes: no delete policy, no delete grant", () => {
    expect(sql).toContain("create table if not exists bank_reconciliations");
    expect(sql).not.toMatch(/for delete/);
    expect(sql).not.toMatch(/grant[^;]*delete/);
    expect(sql).not.toMatch(/\bdrop table\b|\balter table (?!bank_reconciliations)/);
  });

  it("records an undo instead of removing a row, with who and when", () => {
    expect(sql).toContain("status text not null default 'active' check (status in ('active', 'undone'))");
    expect(sql).toContain("check (status <> 'undone' or (undone_by is not null and undone_at is not null))");
  });

  it("guards updates: only active -> undone, recorded figures immutable", () => {
    expect(sql).toContain("before update on bank_reconciliations");
    expect(sql).toContain("if old.status <> 'active' or new.status <> 'undone' then");
    for (const col of ["statement_ending_balance_cents", "cleared_balance_cents", "difference_cents", "cleared_snapshot", "period_end"]) {
      expect(sql).toContain(`new.${col} <> old.${col}`);
    }
  });

  it("forces RLS on workspace access and grants minimally", () => {
    expect(sql).toContain("force row level security");
    expect(sql.split("has_workspace_access(owner_id)").length - 1).toBe(4); // select, insert, update using+check
    expect(sql).not.toContain("auth.uid()");
    const revokeAt = sql.indexOf("revoke all on bank_reconciliations from anon, authenticated;");
    const grantAt = sql.indexOf("grant select, insert, update on bank_reconciliations to authenticated;");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
  });
});
