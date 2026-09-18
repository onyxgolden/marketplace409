// Rollback-based validation for the budgeting foundation migration: every test runs the ACTUAL
// migration file's SQL (read from disk, never duplicated inline) against real seeded rows inside a
// single BEGIN...ROLLBACK transaction, so nothing persists in the shared local dev database no
// matter how many times this file runs. Same helper, same discipline as
// 20260916030000_backfill_financial_events_account_id.migration.test.js.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260918010000_create_budgeting_foundation.sql"),
  "utf8",
);

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

function actingAsSql(ownerId) {
  return `
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"${ownerId}","role":"authenticated"}';
  `;
}

function seedUsersSql() {
  return `
    insert into auth.users (id, email) values
      ('${OWNER_A}', 'budget-owner-a@example.com'),
      ('${OWNER_B}', 'budget-owner-b@example.com');
  `;
}

describe.runIf(await isLocalStackReachable())("budgeting foundation migration", () => {
  it("upsert_budget_category creates a category, then updates the SAME row on a second call for the same natural key", async () => {
    const sql = `
      begin;
      ${seedUsersSql()}
      ${MIGRATION_SQL}
      ${actingAsSql(OWNER_A)}
      do $$
      declare
        v_first budget_categories%rowtype;
        v_second budget_categories%rowtype;
        v_count integer;
      begin
        select * into v_first from upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries', 'personal', 'manual');
        select * into v_second from upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries (renamed)', 'personal', 'manual');

        if v_first.id <> v_second.id then
          raise exception 'expected the second call to update the same row, got a different id';
        end if;
        if v_second.display_label <> 'Groceries (renamed)' then
          raise exception 'expected display_label to be updated, got %', v_second.display_label;
        end if;

        select count(*) into v_count from budget_categories where owner_id = '${OWNER_A}' and normalized_category = 'groceries';
        if v_count <> 1 then
          raise exception 'expected exactly one row for this natural key, found %', v_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("rejects an unrecognized business_scope or source_type", async () => {
    const sql = `
      begin;
      ${seedUsersSql()}
      ${MIGRATION_SQL}
      ${actingAsSql(OWNER_A)}
      do $$
      begin
        begin
          perform upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries', 'not_a_real_scope', 'manual');
          raise exception 'TEST SETUP ERROR: expected an invalid business_scope to be rejected';
        exception when others then
          if sqlerrm not like '%Unrecognized business_scope%' then raise; end if;
        end;

        begin
          perform upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries', 'personal', 'not_a_real_source');
          raise exception 'TEST SETUP ERROR: expected an invalid source_type to be rejected';
        exception when others then
          if sqlerrm not like '%Unrecognized source_type%' then raise; end if;
        end;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("upsert_budget_monthly_allocation creates then updates the same row for the same category/month, and normalizes period_month to the 1st", async () => {
    const sql = `
      begin;
      ${seedUsersSql()}
      ${MIGRATION_SQL}
      ${actingAsSql(OWNER_A)}
      do $$
      declare
        v_category budget_categories%rowtype;
        v_first budget_monthly_allocations%rowtype;
        v_second budget_monthly_allocations%rowtype;
        v_count integer;
      begin
        select * into v_category from upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries', 'personal', 'manual');

        select * into v_first from upsert_budget_monthly_allocation('${OWNER_A}', v_category.id, '2026-09-18', 40000);
        select * into v_second from upsert_budget_monthly_allocation('${OWNER_A}', v_category.id, '2026-09-01', 45000);

        if v_first.id <> v_second.id then
          raise exception 'expected the second call to update the same allocation row, got a different id';
        end if;
        if v_second.planned_amount_cents <> 45000 then
          raise exception 'expected planned_amount_cents updated to 45000, got %', v_second.planned_amount_cents;
        end if;
        if v_first.period_month <> '2026-09-01' then
          raise exception 'expected period_month normalized to the 1st of the month, got %', v_first.period_month;
        end if;

        select count(*) into v_count from budget_monthly_allocations where owner_id = '${OWNER_A}' and category_id = v_category.id;
        if v_count <> 1 then
          raise exception 'expected exactly one allocation row for this category/month, found %', v_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("rejects an allocation for a category id that does not belong to the caller", async () => {
    const sql = `
      begin;
      ${seedUsersSql()}
      ${MIGRATION_SQL}
      ${actingAsSql(OWNER_A)}
      do $$
      begin
        perform upsert_budget_monthly_allocation('${OWNER_A}', 'budget_cat_does_not_exist', '2026-09-01', 1000);
        raise exception 'TEST SETUP ERROR: expected an unknown category id to be rejected';
      exception when others then
        if sqlerrm not like '%Unknown budget category%' then raise; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("owner isolation: RLS hides one owner's budget categories from another owner", async () => {
    const sql = `
      begin;
      ${seedUsersSql()}
      ${MIGRATION_SQL}
      ${actingAsSql(OWNER_A)}
      select upsert_budget_category('${OWNER_A}', 'groceries', 'Groceries', 'personal', 'manual');

      ${actingAsSql(OWNER_B)}
      do $$
      declare
        v_count integer;
      begin
        select count(*) into v_count from budget_categories where owner_id = '${OWNER_A}';
        if v_count <> 0 then
          raise exception 'expected RLS to hide owner A''s category from owner B, but % row(s) were visible', v_count;
        end if;
      end $$;

      do $$
      begin
        perform upsert_budget_category('${OWNER_A}', 'shopping', 'Shopping', 'personal', 'manual');
        raise exception 'TEST SETUP ERROR: expected owner B to be rejected from writing into owner A''s workspace';
      exception when others then
        if sqlerrm not like '%Owner does not match authenticated workspace%' then raise; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });
});
