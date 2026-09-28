import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20260928100000_chart_of_accounts_race.sql.
// This test never touches a database: it proves the migration text carries
// the deactivation/posting coordination contract -- the chart row as the
// serialization point between posting (SHARE lock + active re-check) and
// deactivation (FOR UPDATE + usage check + write in one RPC).
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260928100000_chart_of_accounts_race.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("chart-of-accounts race migration — structural contract", () => {
  it("adds create_ledger_transaction with the category check under a SHARE lock", () => {
    expect(sql).toContain("create function create_ledger_transaction(p_owner_id text, p_event jsonb)");
    expect(sql).toContain("returns jsonb");
    // The lock + active re-check on the chart row.
    expect(sql).toContain("from chart_of_accounts where owner_id = effective_owner_id and code = v_category for share");
    expect(sql).toContain("this account has been deactivated. choose an active account.");
    // Legacy workspaces (chart table absent) skip the check, like the
    // routes' built-in fallback.
    expect(sql).toContain("to_regclass('public.chart_of_accounts') is not null");
    // Server-side floor validation keeps direct RPC callers honest.
    expect(sql).toContain("the amount must be greater than zero.");
    // Mirrors transactionRow.js: the same row shape the old direct insert wrote.
    expect(sql).toContain("tax_deductible, affects_noi, capitalized, source_system, metadata,");
    expect(sql).toContain("grant execute on function create_ledger_transaction(text, jsonb) to authenticated");
  });

  it("adds create_ledger_transactions: batch posting locks every distinct category", () => {
    expect(sql).toContain("create function create_ledger_transactions(p_owner_id text, p_events jsonb)");
    expect(sql).toContain("for v_cat in select u.code from unnest(v_categories) as u(code) order by u.code loop");
    expect(sql).toContain("from chart_of_accounts where owner_id = effective_owner_id and code = v_cat for share");
    expect(sql).toContain("this account has been deactivated: %.");
    // All-or-nothing: the rows insert in the function's single implicit
    // transaction, so a failure anywhere rolls back the whole batch.
    expect(sql).toContain("return jsonb_build_object('created', v_count, 'ids', to_jsonb(v_ids))");
    expect(sql).toContain("grant execute on function create_ledger_transactions(text, jsonb) to authenticated");
  });

  it("hardens create_expense_with_tenant_charge with the same SHARE-lock check", () => {
    expect(sql).toContain("create or replace function create_expense_with_tenant_charge(");
    expect(sql).toContain("from chart_of_accounts where owner_id = required_owner and code = v_category for share");
    expect(sql).toContain("this account has been deactivated. choose an active account.");
    // The rest of the charge-tenant body is unchanged.
    expect(sql).toContain("insert into rent_charges (");
    expect(sql).toContain("'tenantcharge:' || v_event_id");
  });

  it("hardens update_transaction_with_history: row lock first, category check on change only", () => {
    expect(sql).toContain("create or replace function update_transaction_with_history(");
    // The pre-lock: the category check must see a stable row.
    expect(sql).toContain("from financial_events where owner_id = required_owner and id = v_event_id and source_system = 'manual' and is_deleted = false for update");
    // Only a re-categorization takes the chart lock; ordinary memo/date
    // edits on transactions whose account was later deactivated keep working.
    expect(sql).toContain("v_new_category is distinct from v_existing_category");
    expect(sql).toContain("from chart_of_accounts where owner_id = required_owner and code = v_new_category for share");
    // Transfer legs are exempt: their 'transfer' category is not a chart code.
    expect(sql).toContain("v_existing_group is null");
    // The audit coupling is unchanged.
    expect(sql).toContain("insert into financial_event_history (");
  });

  it("adds deactivate_chart_account: FOR UPDATE + usage check + write in one RPC", () => {
    expect(sql).toContain("create function deactivate_chart_account(p_owner_id text, p_account_id text)");
    // The lock comes BEFORE the usage count: a concurrent posting that
    // locked the row first forces this to wait, after which the count sees
    // the new posting and blocks the deactivation.
    const lockAt = sql.indexOf("from chart_of_accounts where owner_id = effective_owner_id and id = v_account_id for update");
    const countAt = sql.indexOf("from financial_events where owner_id = effective_owner_id and normalized_category = v_code");
    expect(lockAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(lockAt);
    // The usage guard mirrors getAccountUsageCount: events + split lines.
    expect(sql).toContain("from financial_event_splits where owner_id = effective_owner_id and normalized_category = v_code");
    expect(sql).toContain("this account has % transaction% posted to it. reassign % to another account before deactivating.");
    // Idempotent: deactivating an already-inactive account succeeds.
    expect(sql).toContain("return jsonb_build_object('id', v_account_id, 'code', v_code, 'is_active', false)");
    expect(sql).toContain("grant execute on function deactivate_chart_account(text, text) to authenticated");
  });

  it("revokes public from every new function and grants only authenticated", () => {
    for (const sig of [
      "create_ledger_transaction(text, jsonb)",
      "create_ledger_transactions(text, jsonb)",
      "deactivate_chart_account(text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function ${sig} from public`);
      expect(sql).toContain(`grant execute on function ${sig} to authenticated`);
    }
  });
});
