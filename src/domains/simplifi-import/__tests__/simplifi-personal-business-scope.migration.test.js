import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name) => readFileSync(
  resolve(process.cwd(), `supabase/migrations/${name}`),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

const scopeSql = readMigration("20260824030000_add_financial_events_business_scope.sql");
const rpcSql = readMigration("20260824040000_allow_personal_simplifi_import_rows.sql");
const originalRpcSql = readMigration("20260824000000_add_simplifi_csv_import.sql");
const fixSql = readMigration("20260824020000_fix_simplifi_approval_security.sql");

describe("financial_events business_scope", () => {
  it("adds a defaulted, constrained business_scope column instead of backfilling", () => {
    expect(scopeSql).toContain("add column if not exists business_scope text not null default 'business'");
    expect(scopeSql).toContain("check (business_scope in ('business', 'personal'))");
    expect(scopeSql).not.toMatch(/update financial_events/);
  });

  it("indexes business_scope for owner-scoped report filtering", () => {
    expect(scopeSql).toContain("idx_financial_events_owner_business_scope");
    expect(scopeSql).toContain("on financial_events(owner_id, business_scope)");
  });
});

describe("approve_simplifi_csv_import personal-row support", () => {
  it("re-declares the RPC in a new migration rather than editing the already-applied one", () => {
    // 20260824000000 and 20260824020000 are already-deployed migrations; editing them in place
    // would not actually change the live function, since Supabase tracks migrations as applied by
    // filename. The original file must therefore be untouched.
    expect(originalRpcSql).toContain("only freshly recomputed safe_missing rows may be approved");
    expect(originalRpcSql).not.toContain("business_scope");
  });

  it("accepts classification safe_missing or personal, rejecting everything else", () => {
    expect(rpcSql).toContain("not in ('safe_missing', 'personal')");
    expect(rpcSql).toContain("only freshly recomputed safe_missing or personal rows may be approved");
  });

  it("preserves the security-definer, RLS-bypassing settings the fix migration established", () => {
    expect(rpcSql).toContain("security definer");
    expect(rpcSql).toContain("set search_path = public");
    expect(rpcSql).toContain("set row_security = off");
    // Confirms these are the exact settings 20260824020000 applied, so re-declaring the function
    // here can't silently regress it back to security invoker.
    expect(fixSql).toContain("security definer");
    expect(fixSql).toContain("set row_security = off");
  });

  it("derives business_scope from the trusted classification, not the client payload", () => {
    expect(rpcSql).toContain("v_business_scope := case when v_row->>'classification' = 'personal' then 'personal' else 'business' end");
  });

  it("forces affects_noi and capitalized false whenever business_scope is not business", () => {
    expect(rpcSql).toContain("(v_business_scope = 'business') and (v_row->>'affects_noi')::boolean");
    expect(rpcSql).toContain("(v_business_scope = 'business') and (v_row->>'capitalized')::boolean");
  });

  it("writes business_scope into financial_events and the real classification into simplifi_import_rows", () => {
    expect(rpcSql).toContain("business_scope, source_system, source_record_id");
    expect(rpcSql).not.toContain("'safe_missing', case when v_inserted");
    expect(rpcSql).toContain("v_row->>'classification', case when v_inserted");
  });

  it("preserves original account scope and Simplifi category as audit evidence in metadata", () => {
    expect(rpcSql).toContain("'account_scope', v_row->>'account_scope'");
    expect(rpcSql).toContain("'simplifi_category', v_row->>'simplifi_category'");
  });

  it("still enforces authenticated ownership and evidence validation", () => {
    expect(rpcSql).toContain("p_owner_id is distinct from auth.uid()::text");
    expect(rpcSql).toContain("previously approved under different mapping or evidence");
    expect(rpcSql).toContain("grant execute on function approve_simplifi_csv_import");
  });
});
