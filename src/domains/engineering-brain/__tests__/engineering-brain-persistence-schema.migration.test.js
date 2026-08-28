import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000000_create_engineering_brain_persistence.sql"),
  "utf8",
).toLowerCase();

describe("Engineering Brain persistence schema migration (checkpoint: Phase 3)", () => {
  it("creates all three tables", () => {
    expect(sql).toContain("create table if not exists engineering_brain_runs");
    expect(sql).toContain("create table if not exists engineering_brain_records");
    expect(sql).toContain("create table if not exists engineering_brain_excluded");
  });

  it("records and excluded rows are scoped to a run via a foreign key with cascade delete", () => {
    expect(sql).toMatch(/run_id text not null references engineering_brain_runs\(id\) on delete cascade/g);
    const cascadeCount = (sql.match(/references engineering_brain_runs\(id\) on delete cascade/g) || []).length;
    expect(cascadeCount).toBe(2);
  });

  it("prevents re-syncing an unchanged commit from accumulating duplicate run rows", () => {
    expect(sql).toContain("unique (commit_sha, index_content_hash)");
  });

  it("enables and forces row level security on all three tables", () => {
    for (const table of ["engineering_brain_runs", "engineering_brain_records", "engineering_brain_excluded"]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
    }
  });

  it("defines is_forge_programmer() as a security definer function, granted only to authenticated", () => {
    expect(sql).toContain("create or replace function public.is_forge_programmer()");
    expect(sql).toContain("returns boolean");
    expect(sql).toContain("security definer");
    expect(sql).toContain("revoke all on function public.is_forge_programmer() from public");
    expect(sql).toContain("grant execute on function public.is_forge_programmer() to authenticated");
  });

  it("mirrors ProgrammerAuthorizationApplication.js's exact allowlisted email, so RLS and the app's own authorization can never disagree", () => {
    expect(sql).toContain("'jasonmorgan99@gmail.com'");
  });

  it("gates every table's every operation behind is_forge_programmer(), not an owner_id-scoped policy -- this is engineering metadata, not owner/tenant data", () => {
    for (const table of ["engineering_brain_runs", "engineering_brain_records", "engineering_brain_excluded"]) {
      expect(sql).toContain(`create policy "${table}_programmer_all" on ${table}`);
    }
    const policyBlock = sql.slice(sql.indexOf('create policy "engineering_brain_runs_programmer_all"'));
    expect(policyBlock).not.toMatch(/owner_id\s*=\s*auth\.uid\(\)/);
  });

  it("never touches any existing table or drops anything -- purely additive", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("drop policy");
    expect(sql).not.toContain("alter table workspace_members");
    expect(sql).not.toContain("delete from");
  });

  it("indexes the columns the query/read-back layer filters on", () => {
    expect(sql).toContain("idx_engineering_brain_records_source_path");
    expect(sql).toContain("idx_engineering_brain_records_source_type");
    expect(sql).toContain("idx_engineering_brain_records_authority_level");
    expect(sql).toContain("idx_engineering_brain_runs_generated_at");
  });
});
