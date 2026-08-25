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
});
