import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the R7 banking migration (print checks + bank
// deposit slips): the four tables, owner-scoped RLS everywhere, the three
// RPCs with their grants, and the safety invariants (voids need reasons,
// check tender needs a check number, deposit items reference income events).
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260930235900_rental_bank_deposits_check_runs.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

function policyBody(name) {
  const match = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  expect(match, `missing policy ${name}`).toBeTruthy();
  return match[0];
}

describe("rental banking (R7) migration", () => {
  it("creates the four tables with client-generated text ids", () => {
    for (const t of [
      "rental_bank_deposits",
      "rental_bank_deposit_items",
      "rental_check_print_runs",
      "rental_check_print_items",
    ]) {
      expect(lower).toContain(`create table if not exists ${t}`);
      expect(lower).toContain("enable row level security");
      expect(lower).toContain("force row level security");
    }
    expect(lower.match(/create table if not exists rental_bank_deposits[\s\S]*?primary key \(owner_id, id\)/)).toBeTruthy();
    expect(lower.match(/create table if not exists rental_check_print_runs[\s\S]*?primary key \(owner_id, id\)/)).toBeTruthy();
  });

  it("keeps every table owner-scoped with has_workspace_access", () => {
    for (const t of [
      "rental_bank_deposits",
      "rental_bank_deposit_items",
      "rental_check_print_runs",
      "rental_check_print_items",
    ]) {
      for (const op of ["select", "insert", "update", "delete"]) {
        expect(policyBody(`${t}_owner_${op}`)).toContain("has_workspace_access(owner_id)");
      }
    }
  });

  it("requires a void reason on voided deposits", () => {
    expect(lower).toContain("rental_bank_deposits_void_has_reason");
    expect(lower).toContain("status <> 'voided' or (void_reason is not null");
  });

  it("requires a check number on check-tender deposit lines", () => {
    expect(lower).toContain("rental_bank_deposit_items_check_needs_number");
    expect(lower).toContain("tender <> 'check' or (check_number is not null");
  });

  it("does not hard-link check-run items to the R4 payment table", () => {
    // Check-run items are immutable snapshots of the check face at print
    // time — no hard FK to the live payment row. (R4 is a hard prerequisite
    // of this migration via the guard at the top, so the table is guaranteed
    // present; the no-FK choice is snapshot isolation, not standalone-ness.)
    expect(lower).not.toMatch(/foreign key[^\n;]*references rental_vendor_payments/);
  });

  it("fails loudly when the R4 prerequisite tables are absent", () => {
    // create_check_print_run() contains static SQL against
    // rental_vendor_payments / rental_vendors, which PostgreSQL resolves at
    // CREATE FUNCTION time — so the migration cannot land without R4. The
    // guard must RAISE (fail loud), never degrade, and must run before the
    // function is created.
    const guardPos = lower.indexOf("to_regclass('public.rental_vendor_payments')");
    const fnPos = lower.indexOf("create or replace function create_check_print_run(");
    expect(guardPos).toBeGreaterThanOrEqual(0);
    expect(lower).toContain("to_regclass('public.rental_vendors')");
    expect(lower).toContain("raise exception");
    expect(lower).toMatch(/requires r4 to be applied first/);
    expect(fnPos).toBeGreaterThanOrEqual(0);
    expect(guardPos).toBeLessThan(fnPos);
  });

  it("defines the three RPCs with authenticated-only grants", () => {
    for (const fn of ["record_bank_deposit", "void_bank_deposit", "create_check_print_run"]) {
      expect(lower).toContain(`create or replace function ${fn}(`);
      expect(lower).toContain(`revoke all on function ${fn}(`);
      expect(lower).toContain(`grant execute on function ${fn}(`);
    }
  });

  it("record_bank_deposit rejects already-banked or already-deposited receipts", () => {
    expect(lower).toContain("bank_account_id is not null");
    expect(lower).toContain("already recorded against a bank account");
    expect(lower).toContain("metadata ->> 'deposit_id' is not null");
    expect(lower).toContain("already on another deposit");
  });

  it("record_bank_deposit posts a single bank-side event, not duplicate income", () => {
    expect(lower).toContain("'bank_deposit'");
    expect(lower).toContain("affects_noi");
    // One income row for the lump total — the item events never gain a bank account.
    expect(lower.match(/insert into financial_events[\s\S]*?'income'[\s\S]*?'bank_deposit'/)).toBeTruthy();
  });

  it("void_bank_deposit is fail-closed on active reconciliations", () => {
    expect(lower).toContain("already reconciled and cannot be voided");
    expect(lower).toContain("cleared_event_ids ?");
  });

  it("create_check_print_run refuses voided and non-check payments", () => {
    expect(lower).toContain("only check payments can be printed.");
    expect(lower).toContain("voided payments cannot be printed.");
    expect(lower).toContain("all checks in a run must be drawn on the same bank account.");
  });
});
