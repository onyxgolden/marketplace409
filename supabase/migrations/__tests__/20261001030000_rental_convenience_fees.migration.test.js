import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R12 convenience-fees migration:
// - default OFF (card_convenience_fee_bps NOT NULL DEFAULT 0, 0..10000 check)
// - fee evidence columns on rental_payments (fee_cents <= amount_cents check)
// - fee consent snapshot on rental_autopay_enrollments
// - the financial_events trigger splits rent (income) from fee
//   (reimbursement), so the fee can never inflate income or NOI
// - autopay enrollment keeps its prior checks and gains an optional
//   fee-consent param stored for card enrollments only
// - every statement is idempotent (add/drop-if-exists guards)
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001030000_rental_convenience_fees.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("r12 convenience fees migration", () => {
  it("adds the workspace fee setting defaulting to OFF with a 0..10000 check", () => {
    expect(lower).toContain("card_convenience_fee_bps integer not null default 0");
    expect(lower).toMatch(/rental_billing_settings_card_fee_bps_check\s*check\s*\(\s*card_convenience_fee_bps\s*>=\s*0\s*and\s*card_convenience_fee_bps\s*<=\s*10000\s*\)/);
  });

  it("adds fee evidence columns to rental_payments with a fee<=amount check", () => {
    expect(lower).toContain("convenience_fee_cents integer not null default 0");
    expect(lower).toContain("convenience_fee_bps integer");
    expect(lower).toContain("fee_agreed_at timestamptz");
    expect(lower).toContain("fee_card_brand text");
    expect(lower).toMatch(/rental_payments_convenience_fee_cents_check\s*check\s*\(\s*convenience_fee_cents\s*>=\s*0\s*and\s*convenience_fee_cents\s*<=\s*amount_cents\s*\)/);
    expect(lower).toMatch(/convenience_fee_bps is null/);
  });

  it("adds the fee consent snapshot to rental_autopay_enrollments", () => {
    expect(lower).toContain("fee_consent_bps integer");
    expect(lower).toContain("fee_consented_at timestamptz");
  });

  it("creates the audit table with forced workspace-access RLS", () => {
    expect(lower).toContain("create table if not exists rental_convenience_fee_audit");
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    expect(lower).toContain("has_workspace_access(owner_id)");
  });

  it("audits every fee change through an authenticated, workspace-scoped RPC", () => {
    expect(lower).toContain("create or replace function public.set_rental_card_convenience_fee(p_owner_id text, p_fee_bps integer)");
    expect(lower).toContain("insert into rental_convenience_fee_audit");
    expect(lower).toContain("grant execute on function public.set_rental_card_convenience_fee(text, integer) to authenticated");
  });

  it("gates the fee RPC to owner-or-active-co_owner via has_workspace_access (defense in depth)", () => {
    // has_workspace_access is owner/co_owner only: p_owner_id = auth.uid() or an
    // active co_owner row. Staff (manager, bookkeeper, read_only) fail it, so even
    // a direct RPC call cannot change the fee.
    const start = lower.indexOf("create or replace function public.set_rental_card_convenience_fee(");
    const end = lower.indexOf("revoke all on function public.set_rental_card_convenience_fee");
    const rpc = lower.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rpc).toMatch(/not\s+has_workspace_access\s*\(\s*p_owner_id\s*\)/);
  });

  it("books the fee as a separate reimbursement row, never income", () => {
    expect(lower).toContain("create or replace function post_succeeded_rental_payment_to_financial_event()");
    // The rent row stays income/rental_income and excludes the fee.
    expect(lower).toMatch(/'rent payment received'[\s\S]*?'income','rental_income'/);
    expect(lower).toMatch(/v_rent_cents\s*:=\s*new\.amount_cents\s*-\s*v_fee_cents/);
    // The fee row is a reimbursement that does not touch NOI.
    expect(lower).toMatch(/'card convenience fee reimbursement'[\s\S]*?'reimbursement'[\s\S]*?'convenience_fee_reimbursement'/);
    expect(lower).toMatch(/'forge_rental_convenience_fee',\s*new\.id/);
    expect(lower).toMatch(/,\s*false\s*,\s*false\s*,\s*false\s*,\s*'forge_rental_convenience_fee'/);
    // Pre-fee rows (fee_cents = 0) post exactly as before: no fee row.
    expect(lower).toContain("if v_fee_cents > 0 then");
    // No income row may carry the fee.
    const feeInsert = lower.match(/'card convenience fee reimbursement'[\s\S]*?;/)[0];
    expect(feeInsert).not.toMatch(/'income'/);
    const rentInsert = lower.match(/'rent payment received'[\s\S]*?;/)[0];
    expect(rentInsert).toContain("v_rent_cents");
  });

  it("keeps pre-fee payment rows unchanged", () => {
    expect(lower).toContain("v_fee_cents:=coalesce(new.convenience_fee_cents,0)");
  });

  it("extends the autopay enrollment RPC with optional card-only fee consent", () => {
    expect(lower).toContain("p_fee_consent_bps integer default null");
    expect(lower).toContain("grant execute on function request_rental_autopay_enrollment(text, text, smallint, smallint, text, text, integer)");
    expect(lower).toMatch(/p_payment_method_type\s*=\s*'card'\s*and\s*p_fee_consent_bps\s*is\s*not\s*null/);
  });

  it("every column/constraint/policy statement is idempotent", () => {
    for (const match of lower.matchAll(/alter table \w+ add (?:column|constraint)/g)) {
      expect(match[0], match[0]).toMatch(/add (?:column|constraint) if not exists/);
    }
    for (const match of lower.matchAll(/alter table \w+ drop (?:column|constraint)/g)) {
      expect(match[0], match[0]).toMatch(/drop (?:column|constraint) if exists/);
    }
    expect(lower).toContain('drop policy if exists "convenience_fee_audit_owner_select"');
  });
});
