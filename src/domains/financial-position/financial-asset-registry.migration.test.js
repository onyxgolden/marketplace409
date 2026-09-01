import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260825010000_add_financial_asset_registry.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("financial asset registry migration", () => {
  it("keeps physical assets owner-scoped and distinct from income and expenses", () => {
    expect(sql).toContain("create table if not exists public.financial_assets");
    expect(sql).toContain("ownership_scope in ('business', 'personal', 'mixed')");
    expect(sql).toContain("financial_assets_owner_all");
    expect(sql).toContain("owner_id = auth.uid()");
    expect(sql).not.toContain("insert into public.financial_events");
  });

  it("records dated valuation evidence and projects it into canonical net worth accounts", () => {
    expect(sql).toContain("create table if not exists public.financial_asset_valuations");
    expect(sql).toContain("'manual', 'simplifi', 'plaid', 'brokerage', 'appraisal', 'market'");
    expect(sql).toContain("insert into public.financial_accounts");
    expect(sql).toContain("'other', p_asset_class");
    expect(sql).toContain("insert into public.account_balances");
  });

  it("creates an asset and its initial valuation atomically under the authenticated owner", () => {
    expect(sql).toContain("create_financial_asset_with_valuation");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("v_owner_id uuid := auth.uid()");
    expect(sql).toContain("grant execute on function public.create_financial_asset_with_valuation");
    expect(sql).toContain("linked property does not belong to authenticated owner");
    expect(sql).toContain("where owner_id = v_owner_id::text and property_id = trim(p_linked_property_id)");
  });

  it("keeps edits, new valuations, canonical balances, and retirement synchronized", () => {
    expect(sql).toContain("update_financial_asset_with_valuation");
    expect(sql).toContain("insert into public.financial_asset_valuations");
    expect(sql).toContain("on conflict (owner_id, asset_id, effective_date, source) do update");
    expect(sql).toContain("insert into public.account_balances");
    expect(sql).toContain("deactivate_financial_asset");
    expect(sql).toContain("set active = false");
    expect(sql).toContain("provider = 'manual_asset'");
    expect(sql).not.toContain("delete from public.financial_assets");
  });

  it("corrects a same-day valuation in place instead of violating account_balances' own (owner_id, financial_account_id, as_of) uniqueness", () => {
    // Review defect: update_financial_asset_with_valuation's financial_asset_valuations insert
    // already had ON CONFLICT DO UPDATE for a same-day resubmission, but its account_balances
    // insert used a fresh id per call with no conflict handling -- a second same-day valuation
    // (a normal "I made a typo, let me fix it" edit) would violate account_balances' existing
    // (owner_id, financial_account_id, as_of) unique index and roll back the entire correction.
    const updateFunctionSql = sql.slice(sql.indexOf("update_financial_asset_with_valuation"));
    expect(updateFunctionSql).toContain(
      "insert into public.account_balances ( id, owner_id, financial_account_id, connection_id, provider, provider_account_id, currency_code, current_balance_cents, available_balance_cents, as_of ) values ( 'account_balance_' || p_valuation_id, v_owner_id, p_asset_id, 'manual_assets', 'manual_asset', p_asset_id, 'usd', p_value_cents, null, p_value_date::timestamptz ) on conflict (owner_id, financial_account_id, as_of) do update set current_balance_cents = excluded.current_balance_cents;",
    );
  });

  it("prevents a real estate property from being double-counted in Net Worth by more than one active asset", () => {
    // Review defect: neither RPC checked whether linked_property_id was already claimed by
    // another active asset for this owner -- two assets could both link to the same property,
    // each with its own canonical account_balances row, silently doubling that property's
    // contribution to Net Worth.
    expect(sql).toContain(
      "create unique index if not exists idx_financial_assets_owner_property_active on public.financial_assets(owner_id, linked_property_id) where active and linked_property_id is not null;",
    );
    expect(
      (sql.match(/already linked to another active asset/g) || []).length,
    ).toBe(2); // one guard in create_financial_asset_with_valuation, one in update_financial_asset_with_valuation
    const updateFunctionGuard = sql.slice(
      sql.indexOf("update_financial_asset_with_valuation"),
      sql.indexOf("update public.financial_assets set name = trim(p_name)"),
    );
    expect(updateFunctionGuard).toContain("and id != p_asset_id");
  });

  it("keeps a retired asset's history but excludes it from active Net Worth (retirement deactivates the canonical account too)", () => {
    // financial_accounts.active = false is set by deactivate_financial_asset; the read side
    // (FinancialPositionQueryService) must actually respect that flag for retirement to have any
    // real effect on Net Worth -- covered directly in FinancialPositionQueryService.test.js since
    // that logic lives in application code, not this migration. Asserted here only that the
    // migration's own retirement path never deletes rows, preserving the history that read side
    // depends on.
    expect(sql).not.toContain("delete from public.financial_asset_valuations");
    expect(sql).not.toContain("delete from public.account_balances");
    expect(sql).not.toContain("delete from public.financial_accounts");
  });
});
