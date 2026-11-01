import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20261101020000_rental_owner_movement_edit.sql
// (controls-sweep follow-up G13, M-19). Mirrors the
// ownerDisbursementRpc.migration.test.js pattern: this test never touches a
// database — it proves the migration text carries the contract. The
// migration itself is NOT applied anywhere by this test.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261101020000_rental_owner_movement_edit.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("owner movement edit migration — structural contract", () => {
  it("creates the append-only audit table with before/after columns", () => {
    expect(sql).toContain("create table if not exists owner_cash_movement_edits (");
    expect(sql).toContain("old_amount numeric not null");
    expect(sql).toContain("new_amount numeric not null");
    expect(sql).toContain("old_movement_date date not null");
    expect(sql).toContain("new_movement_date date not null");
    expect(sql).toContain("old_method text not null");
    expect(sql).toContain("new_method text not null");
    expect(sql).toContain("idx_owner_cash_movement_edits_movement");
  });

  it("creates update_owner_movement as a security-invoker RPC", () => {
    expect(sql).toContain("create or replace function update_owner_movement(");
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security invoker");
  });

  it("scopes the RPC to the authenticated workspace owner and active rows only", () => {
    expect(sql).toContain("public.resolve_effective_owner_id()");
    expect(sql).toContain("owner does not match authenticated owner.");
    expect(sql).toContain("not_active: only an active movement can be edited.");
  });

  it("serializes against concurrent inserts with the disbursement lock namespace", () => {
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('rental_owner_disbursement:'");
  });

  it("recomputes the disbursement balance excluding the edited row", () => {
    expect(sql).toContain("and ocm.id <> p_movement_id;");
    expect(sql).toContain("v_balance_cents := v_income_cents - v_expense_cents - v_disbursement_cents + v_contribution_cents;");
    expect(sql).toContain("over_disbursement:");
  });

  it("writes the audit row and the update in the same transaction", () => {
    expect(sql).toContain("insert into owner_cash_movement_edits (");
    expect(sql).toContain("update owner_cash_movements set");
    expect(sql).toContain("return jsonb_build_object('movement', to_jsonb(v_row));");
  });

  it("grants execute to authenticated only", () => {
    expect(sql).toContain("revoke all on function update_owner_movement(text, text, numeric, date, text, text, text) from public;");
    expect(sql).toContain("grant execute on function update_owner_movement(text, text, numeric, date, text, text, text) to authenticated;");
  });
});
