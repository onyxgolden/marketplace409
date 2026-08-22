import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822020000_add_rentec_payment_import_reconciliation.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("Rentec external-payment reconciliation migration", () => {
  it("creates the import audit/idempotency table with a not-null owner scope", () => {
    expect(sql).toContain("create table if not exists rentec_transaction_imports");
    expect(sql).toContain("owner_id text not null");
    expect(sql).toContain("rentec_transaction_id text not null");
    expect(sql).toContain("status text not null check (status in ('applied', 'rejected'))");
  });

  it("protects the import table with owner-scoped, forced row level security", () => {
    expect(sql).toContain("alter table rentec_transaction_imports enable row level security");
    expect(sql).toContain("alter table rentec_transaction_imports force row level security");
    expect(sql).toContain('create policy "rentec_transaction_imports_owner_select" on rentec_transaction_imports');
    expect(sql).toContain("using (owner_id = auth.uid()::text)");
  });

  it("grants an owner-scoped INSERT policy — without one, the SECURITY INVOKER function's own writes would be denied by forced RLS on every path", () => {
    expect(sql).toContain('create policy "rentec_transaction_imports_owner_insert" on rentec_transaction_imports');
    expect(sql).toContain("for insert to authenticated with check (owner_id = auth.uid()::text)");
  });

  it("enforces true idempotency with a unique partial index on applied imports, not just application-level logic", () => {
    expect(sql).toContain("create unique index if not exists idx_rentec_transaction_imports_applied_dedupe");
    expect(sql).toContain("on rentec_transaction_imports (owner_id, rentec_transaction_id) where status = 'applied'");
  });

  it("approve_rentec_payment_import is owner-authenticated, security invoker, and least-privilege granted", () => {
    expect(sql).toContain("create or replace function approve_rentec_payment_import(");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).toContain(
      "revoke all on function approve_rentec_payment_import(text, text, text, text, bigint, date, text, text, text, text) from public",
    );
    expect(sql).toContain(
      "grant execute on function approve_rentec_payment_import(text, text, text, text, bigint, date, text, text, text, text) to authenticated",
    );
  });

  it("stores the Rentec renter/property attribution alongside amount/date/category as immutable evidence for future drift detection", () => {
    expect(sql).toContain("rentec_renter_id text");
    expect(sql).toContain("rentec_property_id text");
    expect(sql).toContain("p_rentec_renter_id text");
    expect(sql).toContain("p_rentec_property_id text");
    const insertMatches = sql.match(/insert into rentec_transaction_imports \([^)]*\)/g) || [];
    expect(insertMatches).toHaveLength(2);
    for (const insert of insertMatches) {
      expect(insert).toContain("rentec_renter_id");
      expect(insert).toContain("rentec_property_id");
    }
  });

  it("is idempotent on a repeated approval — checks for an existing applied row before writing anything", () => {
    expect(sql).toContain(
      "select * into v_existing from rentec_transaction_imports where owner_id = p_owner_id and rentec_transaction_id = p_rentec_transaction_id and status = 'applied'",
    );
    expect(sql).toContain("if found then return jsonb_build_object('status', 'already_applied'");
  });

  it("rechecks the matched charge and schedule at approval time rather than trusting the caller's preview", () => {
    expect(sql).toContain("select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id and lease_id = p_lease_id for update");
    expect(sql).toContain("select s.* into v_schedule from rent_schedules s where s.owner_id = p_owner_id and s.lease_id = p_lease_id");
    expect(sql).toContain("if not found or v_schedule.collection_mode <> 'external' then");
  });

  it("rejects overpayment against the charge's current remaining balance and audits the rejection instead of applying it", () => {
    expect(sql).toContain("elsif p_amount_cents > v_charge.amount_cents - v_charge.paid_amount_cents then");
    expect(sql).toContain("v_reason := 'transaction amount exceeds the charge''s current remaining balance.'");
    expect(sql).toContain("status, rejection_reason, approved_by)");
  });

  it("supports partial payments — status resolves to partially_paid unless the payment exactly completes the charge", () => {
    expect(sql).toContain("v_new_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end");
  });

  it("records the payment with a provider distinct from stripe and offline, and the insert's own column list never includes a Stripe-only field", () => {
    expect(sql).toContain("'rentec_external'");
    const insertMatch = sql.match(/insert into rental_payments \([^)]*\)/);
    expect(insertMatch).toBeTruthy();
    expect(insertMatch[0]).not.toContain("provider_customer_id");
    expect(insertMatch[0]).not.toContain("provider_mode");
    expect(insertMatch[0]).not.toContain("payment_method");
  });

  it("uses a deterministic idempotency_key derived from the Rentec transaction id, not a fresh random uuid", () => {
    expect(sql).toContain("'rentec:' || p_rentec_transaction_id");
  });

  it("never writes to rent_schedules, rental_billing_settings, or rental_autopay_enrollments, and never inserts a new rent_charges row", () => {
    expect(sql).not.toMatch(/(update|insert into) rent_schedules/);
    expect(sql).not.toMatch(/(update|insert into) rental_billing_settings/);
    expect(sql).not.toMatch(/(update|insert into) rental_autopay_enrollments/);
    expect(sql).not.toMatch(/insert into rent_charges/);
    // The only mutation to rent_charges is an UPDATE of the matched, existing charge's paid amount/status.
    expect(sql).toContain("update rent_charges set paid_amount_cents = v_new_paid, status = v_new_status, updated_at = now()");
  });

  it("stale-preview protection: a schedule that moved off 'external' since the preview was generated is rejected at approval, not silently applied", () => {
    // The recheck reads the CURRENT rent_schedules row fresh inside the function — it never trusts
    // any collection_mode value the caller might have carried over from an earlier preview.
    expect(sql).toContain("select s.* into v_schedule from rent_schedules s where s.owner_id = p_owner_id and s.lease_id = p_lease_id order by s.effective_start_date desc limit 1");
    expect(sql).toContain("v_reason := 'this lease is no longer externally managed; rentec import no longer applies.'");
  });

  it("stale-preview protection: a charge that was voided or paid elsewhere since the preview was generated is rejected, not applied against stale data", () => {
    expect(sql).toContain("select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id and lease_id = p_lease_id for update");
    expect(sql).toContain("if not found or v_charge.status = 'void' then");
  });

  it("rollback-on-failure structure: the applied path only ever writes rental_payments, then updates rent_charges, then audits — in that order, and only after every reject check has already passed", () => {
    const appliedPathStart = sql.indexOf("insert into rental_payments (owner_id, id, charge_id");
    const chargeUpdateIndex = sql.indexOf("update rent_charges set paid_amount_cents = v_new_paid");
    const appliedAuditIndex = sql.lastIndexOf("insert into rentec_transaction_imports");
    expect(appliedPathStart).toBeGreaterThan(-1);
    expect(chargeUpdateIndex).toBeGreaterThan(appliedPathStart);
    expect(appliedAuditIndex).toBeGreaterThan(chargeUpdateIndex);
    // Every reject branch returns immediately, so nothing downstream of a rejection can partially write.
    expect(sql).toContain("return jsonb_build_object('status', 'rejected', 'importid', v_import_id, 'reason', v_reason); end if;");
  });

  it("catches a true concurrent double-approval (unique_violation on the applied dedupe index) and returns the same graceful already_applied response, rather than raising a raw constraint error", () => {
    expect(sql).toContain("exception when unique_violation then");
    const exceptionBlock = sql.slice(sql.indexOf("exception when unique_violation then"));
    expect(exceptionBlock).toContain("select * into v_existing from rentec_transaction_imports");
    expect(exceptionBlock).toContain("return jsonb_build_object('status', 'already_applied'");
  });

  it("writes an audit row on every path, including a rejected recheck, never silently dropping an attempt", () => {
    const auditInserts = (sql.match(/insert into rentec_transaction_imports/g) || []).length;
    expect(auditInserts).toBe(2); // rejected-path insert, and the applied-path insert
  });

  it("NOT applied remotely by this change, matching the containment migration's convention", () => {
    expect(sql).toContain("not applied remotely by this change");
  });
});
