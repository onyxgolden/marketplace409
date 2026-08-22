import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822000000_allow_void_after_reversed_payment.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("void_rental_rent_charge — allows voiding after a fully reversed payment, closes the in-flight-payment gap", () => {
  it("scopes the new payment guard to this exact owner and charge, matching every other predicate", () => {
    expect(sql).toContain("not exists ( select 1 from rental_payments rp where rp.owner_id = p_owner_id and rp.charge_id = required_charge_id and rp.status not in ('refunded', 'failed', 'cancelled') )");
  });

  it("allows a charge whose only payment history is refunded, failed, or cancelled — no outstanding money, safe to void", () => {
    expect(sql).toContain("rp.status not in ('refunded', 'failed', 'cancelled')");
  });

  it("does not exempt succeeded, processing, partially_refunded, disputed, or any pre-success in-flight status from blocking a void", () => {
    for (const blockingStatus of ["succeeded", "processing", "partially_refunded", "disputed", "created", "requires_payment_method", "requires_action"]) {
      expect(sql).not.toContain(`'${blockingStatus}', 'refunded'`);
      expect(sql).not.toContain(`'refunded', '${blockingStatus}'`);
    }
  });

  it("keeps the original paid_amount_cents = 0 and status <> 'void' guards unchanged", () => {
    expect(sql).toContain("and paid_amount_cents = 0");
    expect(sql).toContain("and status <> 'void'");
  });

  it("never touches rental_payments or financial_events — only rent_charges is written, preserving payment and ledger history for audit", () => {
    expect(sql).not.toMatch(/update rental_payments/);
    expect(sql).not.toMatch(/delete from rental_payments/);
    expect(sql).not.toMatch(/update financial_events/);
    expect(sql).not.toMatch(/delete from rent_charges/);
    expect((sql.match(/update rent_charges/g) || []).length).toBe(1);
  });

  it("preserves authenticated-owner authority, the required-fields guard, and the void write itself unchanged", () => {
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain("nullif(btrim(p_charge_id), '')");
    expect(sql).toContain("nullif(btrim(p_reason), '')");
    expect(sql).toContain("status = 'void'");
    expect(sql).toContain("voided_at = now()");
    expect(sql).toContain("revoke all on function void_rental_rent_charge");
    expect(sql).toContain("grant execute on function void_rental_rent_charge");
    expect(sql).toContain("to authenticated");
  });
});
