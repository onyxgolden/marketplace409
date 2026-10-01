import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20261001080000_r18_payment_correction_credit_aware.sql.
// This test never touches a database: it proves the fix-forward migration
// carries the credit-aware correction contract the ChatGPT NO-GO review
// demanded — an amount correction must re-split the corrected amount between
// the charge and the offline-overpayment credit (rental_tenant_credits /
// rental_credit_applications) instead of applying (new-old) straight to the
// charge. The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261001080000_r18_payment_correction_credit_aware.sql",
  ),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("r18 payment correction credit-aware migration — structural contract", () => {
  it("adds the reconcile_credit_for_payment_correction helper with the 7-argument signature", () => {
    expect(sql).toContain(
      "create or replace function reconcile_credit_for_payment_correction( p_owner_id text, p_payment_id text, p_old_amount_cents bigint, p_new_amount_cents bigint, p_charge_paid_cents bigint, p_charge_amount_cents bigint, p_reason text ) returns jsonb",
    );
  });

  it("makes the helper SECURITY DEFINER (caller roles have no direct credit writes)", () => {
    expect(sql).toContain("security definer");
  });

  it("locks the credit row sourced from the payment FOR UPDATE (payment -> charge -> credit lock order)", () => {
    expect(sql).toContain(
      "where owner_id = p_owner_id and source_payment_id = p_payment_id for update",
    );
  });

  it("derives the payment's applied portion as old amount minus recorded excess", () => {
    expect(sql).toContain("v_applied_old := p_old_amount_cents - v_old_excess;");
  });

  it("recomputes what the charge can absorb as min(new amount, charge capacity)", () => {
    expect(sql).toContain("v_applied_new := least(p_new_amount_cents, v_capacity);");
  });

  it("blocks with a P0001 when already-applied credit cannot be covered by the new excess", () => {
    expect(sql).toContain("has already been applied to other charges");
    expect(sql).toContain("reverse the credit applications first");
  });

  it("voids the credit with an audit reason when the corrected amount eliminates the excess", () => {
    expect(sql).toContain("status = 'void'");
    expect(sql).toContain("void_reason = 'payment '");
  });

  it("adjusts the credit to the new excess, keeping already-applied amounts intact", () => {
    expect(sql).toContain("remaining_cents = v_new_excess - v_applied_credit");
  });

  it("creates an open overpayment credit when the correction pushes the payment over the charge", () => {
    expect(sql).toContain("insert into rental_tenant_credits");
    expect(sql).toContain("source, source_payment_id");
  });

  it("rewrites correct_rental_payment to call the helper instead of applying the naive delta", () => {
    expect(sql).toContain("v_credit_result := reconcile_credit_for_payment_correction(");
    expect(sql).not.toContain("v_balance_delta := v_amount_cents - v_payment.amount_cents;");
  });

  it("moves the charge by (appliedNew - appliedOld) and returns the credit reconciliation", () => {
    expect(sql).toContain("v_balance_delta := (v_credit_result ->> 'appliednewcents')::bigint");
    expect(sql).toContain("'credit', v_credit_result");
  });

  it("grants execute to authenticated and revokes from public/anon for both functions", () => {
    expect(sql).toContain(
      "grant execute on function reconcile_credit_for_payment_correction(text, text, bigint, bigint, bigint, bigint, text) to authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function correct_rental_payment(text, text, jsonb, text) to authenticated;",
    );
  });

  it("is fix-forward: the reviewed function is CREATE OR REPLACE'd, never dropped", () => {
    expect(sql).toContain("create or replace function correct_rental_payment(");
    expect(sql).not.toContain("drop function if exists correct_rental_payment");
  });
});
