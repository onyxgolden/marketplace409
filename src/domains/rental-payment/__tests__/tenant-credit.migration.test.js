import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260925120000_rental_tenant_credits.sql"), "utf8");

describe("tenant credit migration", () => {
  it("creates the credit and application tables", () => {
    expect(sql).toContain("create table if not exists rental_tenant_credits");
    expect(sql).toContain("create table if not exists rental_credit_applications");
  });

  it("enforces SELECT-only row-level security for owner and tenant access", () => {
    expect(sql).toContain("enable row level security");
    // No FORCE RLS statement: the definer RPCs run as the table owner and must
    // bypass RLS, while authenticated callers stay policy-bound.
    expect(sql).not.toMatch(/alter table rental_(tenant_credits|credit_applications) force row level security/);
    expect(sql).toContain("rental_tenant_credits_owner_select");
    expect(sql).toContain("rental_credit_applications_owner_select");
    expect(sql).toContain("rental_tenant_credits_tenant_select");
    expect(sql).toContain("rental_actor_has_lease_access");
    // No direct-write policies: mutations go through the definer RPCs only.
    expect(sql).not.toMatch(/on rental_tenant_credits for all/);
    expect(sql).not.toMatch(/on rental_credit_applications for all/);
    expect(sql).toContain("grant select on table rental_tenant_credits to authenticated");
    expect(sql).toContain("grant select on table rental_credit_applications to authenticated");
  });

  it("requires every credit to carry its source payment", () => {
    expect(sql).toMatch(/source_payment_id text not null/);
  });

  it("keeps the full payment amount and records the excess as a credit", () => {
    // The receipt is the full amount actually received — never the applied portion.
    expect(sql).toMatch(/insert into rental_payments[\s\S]*p_amount_cents/);
    expect(sql).toMatch(/insert into rental_tenant_credits[\s\S]*v_excess_cents/);
    expect(sql).toContain("source_payment_id");
  });

  it("still refuses overpayments without the explicit confirmation flag", () => {
    expect(sql).toContain("p_allow_overpayment_credit boolean default false");
    expect(sql).toContain("Payment exceeds the remaining rent balance.");
  });

  it("attributes the credit to the tenant the caller names, validated against the lease", () => {
    expect(sql).toContain("p_tenant_id text default null");
    expect(sql).toContain("Tenant does not belong to this lease.");
  });

  it("is retry-safe: a repeated idempotency key replays the original recording", () => {
    expect(sql).toContain("p_idempotency_key text default null");
    expect(sql).toContain("unique_violation");
    expect(sql).toContain("'replayed', true");
  });

  it("rejects an idempotency key reused with different payment details", () => {
    // A mismatched retry must fail loudly, never return someone else's receipt.
    expect(sql).toContain("create or replace function _replay_offline_rental_payment(");
    expect(sql).toContain("was already used with different payment details");
    // The full submission intent is compared: charge, tenant, amount, method, date, ref, notes.
    expect(sql).toMatch(/v_existing_payment\.charge_id is distinct from p_charge_id/);
    expect(sql).toMatch(/v_existing_payment\.tenant_id is distinct from p_tenant_id/);
    expect(sql).toMatch(/v_existing_payment\.amount_cents is distinct from p_amount_cents/);
    // The private helper is zero-grant: reachable only from the definer RPCs.
    expect(sql).toContain("revoke all on function _replay_offline_rental_payment(");
    expect(sql).not.toMatch(/grant execute on function _replay_offline_rental_payment/);
  });

  it("rechecks the idempotency key after locking the charge", () => {
    // A concurrent retry may win while this transaction waits on the charge lock —
    // the post-lock recheck resolves to the winner instead of double-recording.
    const paymentFn = sql.slice(sql.indexOf("p_idempotency_key: client-generated"));
    const replayCalls = (paymentFn.match(/_replay_offline_rental_payment\(p_owner_id, v_key/g) || []).length;
    expect(replayCalls).toBeGreaterThanOrEqual(3);
    expect(paymentFn).toMatch(/for update;[\s\S]*Post-lock recheck/);
  });

  it("runs credit mutations through SECURITY DEFINER RPCs with a fixed search_path", () => {
    for (const fn of ["record_offline_rental_payment", "apply_rental_tenant_credit",
      "void_rental_tenant_credit", "generate_monthly_rent_charge"]) {
      expect(sql).toContain(`create or replace function ${fn}(`);
    }
    // Every definer RPC pins the search path (SQL-injection hardening per repo precedent).
    const definerCount = (sql.match(/language plpgsql security definer set search_path = public/g) || []).length;
    expect(definerCount).toBeGreaterThanOrEqual(4);
    // Caller-facing RPCs stay authenticated-only.
    expect(sql).toContain("grant execute on function apply_rental_tenant_credit(text, text, text, bigint, text) to authenticated");
    expect(sql).toContain("grant execute on function void_rental_tenant_credit(text, text, text) to authenticated");
    expect(sql).toContain("revoke all on function apply_rental_tenant_credit(text, text, text, bigint, text) from public, anon");
  });

  it("uses composite primary keys (owner_id, id) like the rest of the rental schema", () => {
    // Composite FKs reference (owner_id, id); a bare PK on id alone breaks them.
    const creditsDef = sql.slice(sql.indexOf("create table if not exists rental_tenant_credits"),
      sql.indexOf("create index if not exists idx_rental_tenant_credits_owner_tenant"));
    expect(creditsDef).toContain("primary key (owner_id, id)");
    expect(creditsDef).not.toMatch(/id text primary key/);
    const appsDef = sql.slice(sql.indexOf("create table if not exists rental_credit_applications"),
      sql.indexOf("create index if not exists idx_rental_credit_applications_owner_credit"));
    expect(appsDef).toContain("primary key (owner_id, id)");
    expect(appsDef).not.toMatch(/id text primary key/);
  });

  it("keeps credit applications immutable: no UPDATE or DELETE, ever", () => {
    expect(sql).toContain("trg_rental_credit_applications_immutable");
    expect(sql).toContain("before update or delete on rental_credit_applications");
    expect(sql).toContain("Credit applications are immutable history");
  });

  it("revokes direct table writes from authenticated too, not just public/anon", () => {
    // Supabase default privileges grant ALL to anon/authenticated on new public tables.
    expect(sql).toContain("revoke all on table rental_tenant_credits from public, anon, authenticated;");
    expect(sql).toContain("revoke all on table rental_credit_applications from public, anon, authenticated;");
    expect(sql).toContain("grant select on table rental_tenant_credits to authenticated;");
  });

  it("locks the charge before the credit in every path that touches both rows", () => {
    // generate_monthly_rent_charge locks the generated charge then FIFO-locks credits;
    // apply_rental_tenant_credit must use the same order or the two paths deadlock.
    const applyFn = sql.slice(sql.indexOf("create or replace function apply_rental_tenant_credit("));
    const chargeLock = applyFn.indexOf("into v_charge from rent_charges");
    const creditLock = applyFn.indexOf("into v_credit from rental_tenant_credits");
    expect(chargeLock).toBeGreaterThan(-1);
    expect(creditLock).toBeGreaterThan(-1);
    expect(chargeLock).toBeLessThan(creditLock);
  });

  it("constrains the credit graph: foreign keys and one credit per source payment", () => {
    expect(sql).toContain("references rental_payments(owner_id, id)");
    expect(sql).toContain("references rental_tenant_credits(owner_id, id)");
    expect(sql).toContain("references rent_charges(owner_id, id)");
    expect(sql).toContain("uq_rental_tenant_credits_owner_source_payment");
  });

  it("audits voids with explicit who/when/why columns instead of note surgery", () => {
    expect(sql).toContain("voided_at timestamptz");
    expect(sql).toContain("voided_by text");
    expect(sql).toContain("void_reason text");
    expect(sql).toContain("voided_at = now(), voided_by = auth.uid()::text, void_reason = btrim(p_reason)");
  });

  it("preserves the historical 7-argument payment signature as a wrapper", () => {
    // The 20260912 explicit-grant contract pins this signature; the wrapper keeps it
    // resolving with pre-credit behavior (overpayments rejected).
    expect(sql).toMatch(/create or replace function record_offline_rental_payment\(\s*p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint,\s*p_received_at timestamptz, p_receipt_reference text default null, p_notes text default null\s*\)/);
    expect(sql).toContain("p_notes, false, null, null");
  });

  it("never silently mixes security deposits with rent credit", () => {
    expect(sql).not.toMatch(/security_deposit/i);
  });

  it("provides manual apply and void RPCs with locks and status transitions", () => {
    expect(sql).toContain("create or replace function apply_rental_tenant_credit");
    expect(sql).toContain("create or replace function void_rental_tenant_credit");
    expect(sql).toMatch(/from rental_tenant_credits[\s\S]*for update/);
    expect(sql).toContain("'fully_applied'");
    expect(sql).toContain("A reason is required to void a credit.");
  });

  it("auto-applies credits only when a charge is newly generated, oldest first", () => {
    expect(sql).toContain("create or replace function generate_monthly_rent_charge");
    expect(sql).toContain("if inserted_id is not null then");
    expect(sql).toMatch(/order by created_at asc/i);
  });

  it("preserves the pre-effective-date guard and the 20260829 workspace-access check on charge generation", () => {
    expect(sql).toContain("required_due_date < schedule.effective_start_date");
    expect(sql).toContain("not has_workspace_access(p_owner_id)");
    // A conflict-hit must keep skipping voided charges, exactly as before.
    expect(sql).toContain("and status <> 'void'");
  });
});
