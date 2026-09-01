import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const POLICY_FILE = "20260829001300_convert_financial_policies_to_workspace_access.sql";
const GUARD_RPC_FILE = "20260829001400_convert_financial_rpcs_to_workspace_access.sql";
const WRITE_FIX_FILE = "20260829001500_fix_financial_asset_investment_rpc_owner_resolution.sql";

function loadSql(filename) {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", filename), "utf8").toLowerCase();
}

const policySql = loadSql(POLICY_FILE);
const guardRpcSql = loadSql(GUARD_RPC_FILE);
const writeFixSql = loadSql(WRITE_FIX_FILE);

function codeOnly(sql) {
  return sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

// Data-driven against the exact live pg_policies capture, deduplicated to the 20 policies across 11
// Financial FORGE tables. financial_accounts/financial_events/account_balances use 4 separate
// select/insert/update/delete policies each (the older foundational-table shape); the rest use a
// single "for all" policy (the newer convention).
const POLICY_CONVERSIONS = [
  { table: "financial_accounts", policy: "financial_accounts_owner_delete" },
  { table: "financial_accounts", policy: "financial_accounts_owner_insert" },
  { table: "financial_accounts", policy: "financial_accounts_owner_select" },
  { table: "financial_accounts", policy: "financial_accounts_owner_update" },
  { table: "financial_events", policy: "financial_events_owner_delete" },
  { table: "financial_events", policy: "financial_events_owner_insert" },
  { table: "financial_events", policy: "financial_events_owner_select" },
  { table: "financial_events", policy: "financial_events_owner_update" },
  { table: "account_balances", policy: "Users can delete their own account balances" },
  { table: "account_balances", policy: "Users can insert their own account balances" },
  { table: "account_balances", policy: "Users can select their own account balances" },
  { table: "account_balances", policy: "Users can update their own account balances" },
  { table: "financial_assets", policy: "financial_assets_owner_all" },
  { table: "financial_asset_valuations", policy: "financial_asset_valuations_owner_all" },
  { table: "investment_accounts", policy: "investment_accounts_owner_all" },
  { table: "investment_account_valuations", policy: "investment_account_valuations_owner_all" },
  { table: "simplifi_account_mappings", policy: "simplifi_mappings_owner_all" },
  { table: "simplifi_import_batches", policy: "simplifi_batches_owner_all" },
  { table: "simplifi_import_rows", policy: "simplifi_rows_owner_all" },
  { table: "property_financial_setups", policy: "property_financial_setups_owner_select" },
];

describe("Financial FORGE RLS policy conversion to workspace access (checkpoint 4)", () => {
  it(`converts every one of the ${POLICY_CONVERSIONS.length} captured owner-management policies`, () => {
    for (const { table, policy } of POLICY_CONVERSIONS) {
      const lowerPolicy = policy.toLowerCase();
      expect(policySql, `expected a drop for "${policy}" on ${table}`).toContain(`drop policy "${lowerPolicy}" on ${table}`);
      expect(policySql, `expected a has_workspace_access recreate for "${policy}" on ${table}`).toContain(`create policy "${lowerPolicy}" on ${table}`);
    }
  });

  it("preserves the transitive financial_accounts ownership check on simplifi_account_mappings and simplifi_import_rows, converted alongside the direct check", () => {
    for (const table of ["simplifi_account_mappings", "simplifi_import_rows"]) {
      const start = policySql.indexOf(`create policy "${table === "simplifi_account_mappings" ? "simplifi_mappings_owner_all" : "simplifi_rows_owner_all"}" on ${table}`);
      const block = policySql.slice(start, start + 600);
      expect(block, `${table}: expected the transitive exists() check`).toContain("exists (");
      expect(block, `${table}: expected financial_accounts in the transitive check`).toContain("from financial_accounts a");
      expect(block, `${table}: transitive check should use has_workspace_access(a.owner_id), not auth.uid()`).toContain("has_workspace_access(a.owner_id)");
      expect(block, `${table}: should not retain the old auth.uid() form in the transitive check`).not.toContain("a.owner_id = auth.uid()");
    }
  });

  it("uses has_workspace_access(owner_id) uniformly for both text-typed and uuid-typed owner_id columns", () => {
    // financial_accounts/financial_events/account_balances/property_financial_setups/simplifi_* are
    // text-typed; financial_assets/financial_asset_valuations/investment_accounts/
    // investment_account_valuations/account_balances are uuid-typed -- Postgres resolves the correct
    // has_workspace_access overload from the column's own type, so the call site looks identical.
    expect(policySql).toContain("has_workspace_access(owner_id)");
    expect(policySql).not.toMatch(/using\s*\(\s*owner_id\s*=\s*auth\.uid\(\)/);
    expect(policySql).not.toMatch(/using\s*\(\s*auth\.uid\(\)\s*=\s*owner_id/);
  });

  it("never deletes any existing table or data, and never edits a historical migration file", () => {
    expect(policySql).not.toContain("drop table");
    expect(policySql).not.toContain("delete from");
  });
});

describe("Financial FORGE RPC guard conversion to workspace access (checkpoint 4)", () => {
  const GUARD_FUNCTIONS = ["approve_simplifi_csv_import", "save_property_financial_setup", "approve_rentec_financial_history_import"];

  it("redefines all 3 p_owner_id-guarded financial RPCs with a has_workspace_access guard", () => {
    for (const name of GUARD_FUNCTIONS) {
      expect(guardRpcSql).toContain(`create or replace function public.${name}(`);
    }
    expect(guardRpcSql).toContain("has_workspace_access(p_owner_id)");
  });

  it("no redefined function's actual code still compares p_owner_id to auth.uid() or authenticated_owner_id by equality", () => {
    const code = codeOnly(guardRpcSql);
    expect(code).not.toMatch(/p_owner_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/);
    expect(code).not.toContain("p_owner_id <> authenticated_owner_id");
  });

  it("preserves all 3 functions' security definer / row_security off attributes, since they bypass RLS by design", () => {
    const definerCount = (codeOnly(guardRpcSql).match(/security definer/g) || []).length;
    expect(definerCount).toBe(3);
    const rowSecurityCount = (codeOnly(guardRpcSql).match(/set row_security to 'off'/g) || []).length;
    expect(rowSecurityCount).toBe(3);
  });
});

describe("Financial asset/investment RPC owner-resolution write-time bug fix (checkpoint 4)", () => {
  const WRITE_FUNCTIONS = [
    "create_financial_asset_with_valuation", "update_financial_asset_with_valuation", "deactivate_financial_asset",
    "create_investment_account_with_valuation", "update_investment_account_with_valuation", "deactivate_investment_account",
  ];

  it("redefines all 6 asset/investment RPCs to resolve v_owner_id via resolve_effective_owner_id(), not bare auth.uid()", () => {
    for (const name of WRITE_FUNCTIONS) {
      expect(writeFixSql, `expected create or replace function for ${name}`).toContain(`create or replace function public.${name}(`);
    }
    const resolveCallCount = (codeOnly(writeFixSql).match(/v_owner_id uuid := public\.resolve_effective_owner_id\(\)::uuid;/g) || []).length;
    expect(resolveCallCount).toBe(6);
  });

  it("no redefined function still assigns v_owner_id directly from bare auth.uid()", () => {
    const code = codeOnly(writeFixSql);
    expect(code).not.toContain("v_owner_id uuid := auth.uid();");
  });

  it("preserves the null-authenticated-owner guard exactly as before -- resolve_effective_owner_id() can still return null", () => {
    const nullGuardCount = (writeFixSql.match(/if v_owner_id is null then raise exception 'authenticated owner is required\.'; end if;/g) || []).length;
    expect(nullGuardCount).toBe(6);
  });

  it("never deletes any existing table, data, or function, and never edits a historical migration file", () => {
    expect(writeFixSql).not.toContain("drop table");
    expect(writeFixSql).not.toContain("drop function");
  });
});
