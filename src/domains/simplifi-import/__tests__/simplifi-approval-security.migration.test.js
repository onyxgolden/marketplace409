import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name) => readFileSync(
  resolve(process.cwd(), `supabase/migrations/${name}`),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

const approvalSql = readMigration("20260824000000_add_simplifi_csv_import.sql");
const hardeningSql = readMigration("20260824010000_harden_financial_events_trusted_source_provenance.sql");
const fixSql = readMigration("20260824020000_fix_simplifi_approval_security.sql");

describe("Simplifi approval security correction", () => {
  it("elevates only the exact Simplifi approval RPC with RLS disabled", () => {
    const signature = "approve_simplifi_csv_import(text, text, text, text, jsonb)";
    expect(fixSql.match(new RegExp(signature.replace(/[()]/g, "\\$&"), "g"))).toHaveLength(3);
    expect(fixSql).toContain("security definer");
    expect(fixSql).toContain("set search_path = public");
    expect(fixSql).toContain("set row_security = off");
    expect(fixSql).not.toContain("create policy");
    expect(fixSql).not.toContain("drop policy");
  });

  it("retains the RPC's authenticated owner and trusted-source checks", () => {
    expect(approvalSql).toContain("p_owner_id is distinct from auth.uid()::text");
    expect(approvalSql).toContain("only freshly recomputed safe_missing rows may be approved");
    expect(approvalSql).toContain("previously approved under different mapping or evidence");
    expect(approvalSql).toContain("'quicken_simplifi_csv'");
  });

  it("does not weaken the direct-write policy for financial events", () => {
    expect(hardeningSql).toContain("source_system = 'manual'");
    expect(fixSql).not.toContain("financial_events_owner_insert");
    expect(fixSql).not.toContain("financial_events_owner_update");
    expect(fixSql).not.toContain("financial_events_owner_delete");
  });
});
