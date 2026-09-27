import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20260927120000_ledger_transaction_fields.sql.
// This test never touches a database: it proves the migration text carries the
// ledger-parity slice 1 contract — the transaction-form columns on
// financial_events, the financial_event_edits audit table with owner-safe RLS,
// and the create_expense_with_tenant_charge replacement that stores the new
// event keys on the atomic charge-tenant path.
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260927120000_ledger_transaction_fields.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("ledger transaction fields migration — structural contract", () => {
  it("adds the transaction-form columns to financial_events", () => {
    expect(sql).toContain("alter table financial_events add column if not exists display_as text");
    expect(sql).toContain("add column if not exists ref_number text");
    expect(sql).toContain("add column if not exists payee_mailing_address text");
    expect(sql).toContain("add column if not exists assigned_to text");
    expect(sql).toContain("add column if not exists is_recurring boolean not null default false");
    expect(sql).toContain("add column if not exists recurrence_rule text");
    expect(sql).toContain("add column if not exists depreciate boolean not null default false");
  });

  it("creates financial_event_edits keyed to its event with cascade delete", () => {
    expect(sql).toContain("create table if not exists financial_event_edits");
    expect(sql).toContain("event_id text not null references financial_events(id) on delete cascade");
    expect(sql).toContain("edited_by text");
    expect(sql).toContain("changes jsonb not null");
    expect(sql).toContain("idx_financial_event_edits_event");
  });

  it("gives financial_event_edits the same owner-scoped RLS shape as splits/attachments", () => {
    expect(sql).toContain("alter table financial_event_edits enable row level security");
    expect(sql).toContain("alter table financial_event_edits force row level security");
    expect(sql).toContain("financial_event_edits_owner_select");
    expect(sql).toContain("financial_event_edits_owner_insert");
    expect(sql).toContain("financial_event_edits_owner_update");
    expect(sql).toContain("financial_event_edits_owner_delete");
    expect(sql).toContain("has_workspace_access(owner_id)");
  });

  it("replaces create_expense_with_tenant_charge so the atomic path stores the new event keys", () => {
    expect(sql).toContain("create or replace function create_expense_with_tenant_charge");
    expect(sql).toContain("display_as, ref_number, payee_mailing_address, assigned_to");
    expect(sql).toContain("is_recurring, recurrence_rule, depreciate");
    expect(sql).toContain("p_event ->> 'displayas'");
    expect(sql).toContain("p_event ->> 'recurrencerule'");
    expect(sql).toContain("recurrence rule must be weekly, biweekly, monthly, quarterly, or yearly.");
    expect(sql).toContain("grant execute on function create_expense_with_tenant_charge(text, jsonb, jsonb) to authenticated");
  });

  it("adds update_transaction_with_history: the edit and its audit row live in one function (one transaction)", () => {
    const start = sql.indexOf("create or replace function update_transaction_with_history");
    expect(start).toBeGreaterThan(-1);
    // The function body runs between its declaration and the revoke line:
    // the event update and the history insert must both be inside it, so a
    // failed history insert aborts the function and rolls the edit back.
    const body = sql.slice(start, sql.indexOf("revoke all on function update_transaction_with_history"));
    expect(body).toContain("security invoker");
    expect(body).toContain("update financial_events set");
    expect(body).toContain("insert into financial_event_edits (owner_id, event_id, edited_by, changes)");
    expect(body).toContain("if v_changes <> '{}'::jsonb then");
    expect(body).toContain("owner does not match authenticated owner.");
    expect(body).toContain("transaction was not found.");
    expect(body).toContain("the selected bank account was not found.");
    expect(sql).toContain("revoke all on function update_transaction_with_history(text, text, jsonb, jsonb, text, timestamptz) from public");
    expect(sql).toContain("grant execute on function update_transaction_with_history(text, text, jsonb, jsonb, text, timestamptz) to authenticated");
  });
});
