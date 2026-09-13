import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260913040000_add_reservation_financial_contract.sql"),
  "utf8",
).toLowerCase();

describe("reservation financial-contract migration", () => {
  it("uses reservation-native storage without fabricating lease-domain records", () => {
    expect(sql).toContain("create table if not exists public.reservation_financial_contracts");
    expect(sql).toContain("create table if not exists public.reservation_payment_attempts");
    expect(sql).toContain("create table if not exists public.reservation_payment_events");
    expect(sql).not.toMatch(/insert into public\.(rental_tenants|rental_leases|rent_schedules|rent_charges|rental_payments)/);
  });

  it("preserves and reconciles every quoted cent component", () => {
    for (const column of [
      "lodging_amount_cents", "cleaning_fee_cents", "lodging_tax_cents",
      "booking_balance_cents", "security_deposit_cents", "total_due_cents", "currency_code",
    ]) expect(sql).toContain(column);
    expect(sql).toContain("booking_balance_cents = lodging_amount_cents + cleaning_fee_cents + lodging_tax_cents");
    expect(sql).toContain("total_due_cents = booking_balance_cents + security_deposit_cents");
  });

  it("initializes exactly one immutable snapshot for new and existing reservations", () => {
    expect(sql).toContain("after insert on public.reservations");
    expect(sql).toContain("on conflict (owner_id, reservation_id) do nothing");
    expect(sql).toContain("reservation financial snapshot is immutable");
  });

  it("binds every financial record to the canonical owner and reservation", () => {
    expect(sql.match(/foreign key \(owner_id, reservation_id\)/g)).toHaveLength(3);
    expect(sql).toContain("foreign key (owner_id, guest_id)");
  });

  it("keeps payment, refund, dispute, settlement, and payout amounts distinct", () => {
    for (const column of [
      "applied_amount_cents", "refunded_amount_cents", "disputed_amount_cents",
      "settled_amount_cents", "paid_out_amount_cents", "settlement_status",
    ]) expect(sql).toContain(column);
    expect(sql).toContain("paid_out_amount_cents <= settled_amount_cents");
  });

  it("rejects delayed status regression and decreasing cumulative amounts", () => {
    expect(sql).toContain("reservation payment status transition is not monotonic");
    expect(sql).toContain("reservation payment cumulative amounts cannot decrease");
    expect(sql).not.toContain("old.payment_status = 'succeeded' and new.payment_status in ('pending','processing')");
  });

  it("makes payment events immutable", () => {
    expect(sql).toContain("reservation payment events are immutable");
    expect(sql).toContain("before update or delete on public.reservation_payment_events");
  });

  it("uses RLS for workspace reads and gives browser roles no writes", () => {
    expect(sql.match(/force row level security/g)).toHaveLength(3);
    expect(sql.match(/public\.has_workspace_access\(owner_id\)/g)).toHaveLength(3);
    expect(sql).toContain("grant select on table public.reservation_financial_contracts to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete).*authenticated/);
    expect(sql).not.toMatch(/grant .* to anon/);
  });

  it("exposes honest read-model states while keeping collection disabled", () => {
    for (const state of ["unpaid", "processing", "paid", "partially_refunded", "refunded", "disputed", "pending", "available", "paid_out"]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain("'paymentcollectionenabled', false");
  });

  it("does not add Stripe, checkout, webhook, or settlement mutations", () => {
    expect(sql).not.toMatch(/stripe|paymentintent|checkout session|webhook/);
    expect(sql).not.toContain("create table if not exists public.reservation_settlements");
  });
});
