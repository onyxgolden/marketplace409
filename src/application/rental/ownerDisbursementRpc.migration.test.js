import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20261001013000_owner_disbursement_atomic_rpc.sql
// (Rentec-parity R9 follow-up: the ChatGPT GO WITH FIXES finding on PR #514).
//
// The finding: POST /api/rental/owner-movements computed the owner balance in
// application code, validated amount <= balance, and only afterward performed
// a separate INSERT — two concurrent disbursements could both read the same
// balance and both succeed. The required fix: move the balance re-check and
// the insert into one database transaction with serialization that makes
// competing disbursements for the same effective owner mutually exclusive.
//
// This test never touches a database: it proves the migration text carries
// that contract — a stable per-owner advisory lock taken BEFORE the balance
// is recomputed, the invariant enforced after the recompute, and the insert
// last, all in one function body (one transaction). The migration itself is
// NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001013000_owner_disbursement_atomic_rpc.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("owner disbursement atomic RPC — structural contract", () => {
  it("creates record_owner_disbursement as a security-invoker RPC", () => {
    expect(sql).toContain("create or replace function record_owner_disbursement(");
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security invoker");
  });

  it("scopes the RPC to the authenticated workspace owner", () => {
    expect(sql).toContain("public.resolve_effective_owner_id()");
    expect(sql).toContain("owner does not match authenticated owner.");
  });

  it("serializes competing disbursements with a stable per-owner advisory lock", () => {
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('rental_owner_disbursement:'");
  });

  it("recomputes the live balance after the lock, mirroring buildOwnerBalance", () => {
    expect(sql).toContain("from financial_events fe");
    expect(sql).toContain("fe.transaction_kind = 'income'");
    expect(sql).toContain("fe.transaction_kind = 'expense'");
    expect(sql).toContain("fe.is_deleted is not true");
    expect(sql).toContain("coalesce(fe.status, '') not in ('inactive', 'deleted')");
    expect(sql).toContain("from owner_cash_movements ocm");
    expect(sql).toContain("ocm.status = 'active'");
    expect(sql).toContain("abs(round(fe.amount * 100))::bigint");
    expect(sql).toContain("abs(round(ocm.amount * 100))::bigint");
    expect(sql).toContain(
      "v_balance_cents := v_income_cents - v_expense_cents - v_disbursement_cents + v_contribution_cents;",
    );
  });

  it("enforces the over-disbursement invariant at the database boundary", () => {
    expect(sql).toContain("if v_amount_cents > v_balance_cents then");
    expect(sql).toContain("raise exception 'over_disbursement:");
  });

  it("inserts the disbursement only after the lock and the invariant check", () => {
    const lockAt = sql.indexOf("pg_advisory_xact_lock");
    const balanceAt = sql.indexOf("v_balance_cents :=");
    const invariantAt = sql.indexOf("if v_amount_cents > v_balance_cents then");
    const insertAt = sql.indexOf("insert into owner_cash_movements");
    expect(lockAt).toBeGreaterThan(-1);
    expect(balanceAt).toBeGreaterThan(-1);
    expect(invariantAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    // Lock -> recompute -> invariant -> insert: the order that closes the race.
    expect(lockAt).toBeLessThan(balanceAt);
    expect(balanceAt).toBeLessThan(invariantAt);
    expect(invariantAt).toBeLessThan(insertAt);
  });

  it("returns the inserted row so the route can serialize it", () => {
    expect(sql).toContain("returning * into v_row");
    expect(sql).toContain("jsonb_build_object('movement', to_jsonb(v_row), 'balancecents', v_balance_cents)");
  });

  it("grants execute to authenticated and no one else", () => {
    expect(sql).toContain(
      "revoke all on function record_owner_disbursement(text, text, numeric, date, text, text, text) from public;",
    );
    expect(sql).toContain(
      "grant execute on function record_owner_disbursement(text, text, numeric, date, text, text, text) to authenticated;",
    );
  });
});
