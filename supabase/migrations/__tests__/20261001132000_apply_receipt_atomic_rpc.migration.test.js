import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20261001132000_apply_receipt_atomic_rpc.sql
// (Rentec-parity R26 follow-up: the ChatGPT NO-GO findings on PR #531).
//
// Finding 1: one-click apply allowed receiptCents > billBalance, recorded a
// vendor payment for only billBalance, then marked the ENTIRE receipt
// status='applied' — the unapplied remainder disappeared. Required fix:
// require receiptCents === billBalance for the one-click whole-receipt apply
// with a clear split-required error for either direction of mismatch.
//
// Finding 2: record_vendor_payment committed in its own RPC transaction and
// the rental_receipts status/link update was a separate request — a failed
// update reported 500 while the payment had already committed. Required fix:
// make payment + receipt application one atomic database operation.
//
// This test never touches a database: it proves the migration text carries
// that contract — the receipt row locked BEFORE anything else, the
// exact-match invariant enforced at the database boundary, the validated R4
// record_vendor_payment logic INVOKED (not forked) inside the same function
// body, and the receipt linkage updated after the payment in the same
// transaction. The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001132000_apply_receipt_atomic_rpc.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("apply receipt atomic RPC — structural contract", () => {
  it("creates apply_receipt_to_bill as a security-invoker RPC", () => {
    expect(sql).toContain("create or replace function apply_receipt_to_bill(");
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security invoker");
  });

  it("scopes the RPC to the authenticated workspace owner", () => {
    expect(sql).toContain("public.resolve_effective_owner_id()");
    expect(sql).toContain("owner does not match authenticated owner.");
  });

  it("locks the receipt row before doing anything else", () => {
    expect(sql).toContain("from rental_receipts");
    expect(sql).toContain("for update;");
    expect(sql).toContain("only inbox receipts can be applied.");
  });

  it("enforces the exact-match rule at the database boundary (finding 1)", () => {
    expect(sql).toContain("if v_receipt.amount_cents <> v_balance then");
    expect(sql).toContain("split_required:");
    expect(sql).toContain("split application is not supported yet");
  });

  it("recomputes the live bill balance under a row lock before the exact-match check", () => {
    expect(sql).toContain("from rental_vendor_bills");
    expect(sql).toContain("v_balance := v_bill.amount_cents - coalesce(v_bill.paid_amount_cents, 0);");
  });

  it("invokes the validated R4 payment logic instead of forking it (finding 2)", () => {
    expect(sql).toContain("v_result := record_vendor_payment(p_owner_id, v_payment);");
    // Amounts are normalized from the locked rows, not trusted from the caller.
    expect(sql).toContain("'amountcents', v_balance");
  });

  it("updates the receipt linkage after the payment, in the same transaction", () => {
    expect(sql).toContain("update rental_receipts");
    expect(sql).toContain("status = 'applied'");
    expect(sql).toContain("applied_bill_id = v_bill.id");
    expect(sql).toContain("applied_payment_id = v_payment_id");
    // Unknown-vendor receipts adopt the bill's vendor.
    expect(sql).toContain("vendor_id = coalesce(v_receipt.vendor_id, v_bill.vendor_id)");
  });

  it("orders the operations so no partial state can commit", () => {
    const receiptLockAt = sql.indexOf("from rental_receipts");
    const exactMatchAt = sql.indexOf("if v_receipt.amount_cents <> v_balance then");
    const paymentAt = sql.indexOf("v_result := record_vendor_payment(p_owner_id, v_payment);");
    const receiptUpdateAt = sql.indexOf("update rental_receipts");
    expect(receiptLockAt).toBeGreaterThan(-1);
    expect(exactMatchAt).toBeGreaterThan(-1);
    expect(paymentAt).toBeGreaterThan(-1);
    expect(receiptUpdateAt).toBeGreaterThan(-1);
    // Lock -> exact-match invariant -> payment -> receipt linkage:
    // one function body = one transaction = atomic.
    expect(receiptLockAt).toBeLessThan(exactMatchAt);
    expect(exactMatchAt).toBeLessThan(paymentAt);
    expect(paymentAt).toBeLessThan(receiptUpdateAt);
  });

  it("grants execute to authenticated only", () => {
    expect(sql).toContain(
      "revoke all on function apply_receipt_to_bill(text, text, jsonb) from public, anon;"
    );
    expect(sql).toContain(
      "grant execute on function apply_receipt_to_bill(text, text, jsonb) to authenticated;"
    );
  });
});
