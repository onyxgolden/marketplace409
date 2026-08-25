import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826010000_add_investment_account_registry.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("investment account registry migration", () => {
  it("keeps investment accounts owner-scoped and distinct from income and expenses", () => {
    expect(sql).toContain("create table if not exists public.investment_accounts");
    expect(sql).toContain("ownership_scope in ('business', 'personal', 'mixed')");
    expect(sql).toContain("investment_accounts_owner_all");
    expect(sql).toContain("owner_id = auth.uid()");
    expect(sql).not.toContain("insert into public.financial_events");
  });

  it("records dated valuation evidence and projects it into canonical net worth accounts as type investment (not other)", () => {
    expect(sql).toContain("create table if not exists public.investment_account_valuations");
    expect(sql).toContain("'manual', 'simplifi', 'plaid', 'brokerage', 'custodian_statement'");
    expect(sql).toContain("insert into public.financial_accounts");
    expect(sql).toContain("'investment', p_account_type");
    expect(sql).toContain("insert into public.account_balances");
  });

  it("creates an account and its initial valuation atomically under the authenticated owner", () => {
    expect(sql).toContain("create_investment_account_with_valuation");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("v_owner_id uuid := auth.uid()");
    expect(sql).toContain("grant execute on function public.create_investment_account_with_valuation");
  });

  it("keeps edits, new valuations, canonical balances, and retirement synchronized", () => {
    expect(sql).toContain("update_investment_account_with_valuation");
    expect(sql).toContain("insert into public.investment_account_valuations");
    expect(sql).toContain("on conflict (owner_id, account_id, effective_date, source) do update");
    expect(sql).toContain("insert into public.account_balances");
    expect(sql).toContain("deactivate_investment_account");
    expect(sql).toContain("set active = false");
    expect(sql).toContain("provider = 'manual_investment'");
    expect(sql).not.toContain("delete from public.investment_accounts");
  });

  it("corrects a same-day valuation in place instead of violating account_balances' own (owner_id, financial_account_id, as_of) uniqueness", () => {
    // Same defect class already found and fixed once in the financial_assets registry -- baked in
    // correctly here from the start rather than repeating the same review cycle.
    const updateFunctionSql = sql.slice(sql.indexOf("update_investment_account_with_valuation"));
    expect(updateFunctionSql).toContain(
      "insert into public.account_balances ( id, owner_id, financial_account_id, connection_id, provider, provider_account_id, currency_code, current_balance_cents, available_balance_cents, as_of ) values ( 'account_balance_' || p_valuation_id, v_owner_id, p_account_id, 'manual_investments', 'manual_investment', p_account_id, 'usd', p_value_cents, null, p_value_date::timestamptz ) on conflict (owner_id, financial_account_id, as_of) do update set current_balance_cents = excluded.current_balance_cents;",
    );
  });

  it("prevents an accidental double-entry of the same account name from double-counting it in Net Worth", () => {
    expect(sql).toContain(
      "create unique index if not exists idx_investment_accounts_owner_name_active on public.investment_accounts(owner_id, name) where active;",
    );
  });

  it("keeps a retired account's history but excludes it from active Net Worth (retirement deactivates the canonical account too)", () => {
    // financial_accounts.active = false is set by deactivate_investment_account; the read side
    // (FinancialPositionQueryService) already respects that flag (fixed during the financial_assets
    // review) so no further application-code change was needed for this feature to retire cleanly.
    expect(sql).not.toContain("delete from public.investment_account_valuations");
    expect(sql).not.toContain("delete from public.account_balances");
    expect(sql).not.toContain("delete from public.financial_accounts");
  });
});
