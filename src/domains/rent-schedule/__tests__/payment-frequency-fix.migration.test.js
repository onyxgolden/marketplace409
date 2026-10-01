// R13 fix (NO-GO findings): the corrected generate_monthly_rent_charge keeps
// the newest reviewed generator as the base (workspace auth, SECURITY DEFINER,
// idempotent fresh-insert detection, FIFO credit auto-apply, void handling,
// R10 begin-charges gate, canonical period/start parity) with frequency as an
// ADDITIVE branch, and change_rental_payment_frequency runs the schedule
// change + owner notification in one transaction.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001041500_rental_payment_frequency_fix.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("payment frequency fix migration", () => {
  it("keeps the workspace/co-owner authorization model, not owner-only", () => {
    // An authorized co-owner (effective workspace member) can generate, not
    // just the p_owner_id = auth.uid() caller.
    expect(sql).toContain("not has_workspace_access(p_owner_id)");
    expect(sql).not.toContain("p_owner_id <> authenticated_owner_id");
  });
  it("keeps the SECURITY DEFINER execution model with locked search_path", () => {
    expect(sql).toContain("create or replace function generate_monthly_rent_charge");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("revoke all on function generate_monthly_rent_charge(text, text, text) from public");
    expect(sql).toContain("grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated");
  });
  it("keeps the R10 begin-charges gate (no charge due before begin_charges_date)", () => {
    expect(sql).toContain("select begin_charges_date into lease_begin_charges_date from rental_leases");
    expect(sql).toContain("if lease_begin_charges_date is not null and required_due_date < lease_begin_charges_date then return null;");
  });
  it("keeps the canonical period/start parity rule on the monthly path", () => {
    // Eligibility decided by the period's last possible day (YYYY-MM-28),
    // so a late-month move-in keeps its move-in month eligible.
    expect(sql).toContain("required_period_end := (required_period || '-28')::date;");
  });
  it("auto-applies tenant credits exactly once: only on the fresh insert", () => {
    // The fresh-insert detection is what makes credit application exactly
    // once; a conflict-hit returns the existing charge without touching
    // credits, so re-running generation never double-applies.
    expect(sql).toContain("on conflict (owner_id, source_key) do nothing");
    expect(sql).toContain("returning id into inserted_id;");
    expect(sql).toContain("if inserted_id is not null then");
    expect(sql).toContain("order by created_at asc, id asc");
    expect(sql).toContain("where owner_id = p_owner_id and source_key = required_source_key and status <> 'void'");
  });
  it("adds frequency as an additive branch: monthly keeps its exact prior behavior", () => {
    expect(sql).toContain("v_frequency := coalesce(schedule.payment_frequency, 'monthly');");
    expect(sql).toContain("required_period !~ '^[0-9]{4}-[0-9]{2}$'");
    expect(sql).toContain("required_amount := schedule.amount_cents;");
    expect(sql).toContain("required_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(sql).toContain("v_periods_per_year");
  });
  it("defines change_rental_payment_frequency as one atomic schedule-change + notification transaction", () => {
    expect(sql).toContain("create or replace function change_rental_payment_frequency(");
    // Tenant identity comes from auth.uid(), never from the client.
    expect(sql).toContain("select * into v_tenant from rental_tenants where auth_user_id = auth.uid();");
    // The owner notification insert lives inside the same function body as
    // the schedule update -- no second RPC call for the route to fail on.
    expect(sql).toContain("insert into rental_conversations");
    expect(sql).toContain("insert into rental_conversation_messages");
    expect(sql).toContain("revoke all on function change_rental_payment_frequency(text, text) from public, anon;");
    expect(sql).toContain("grant execute on function change_rental_payment_frequency(text, text) to authenticated;");
  });
  it("keeps the no-op fast path and the owner gate on the new RPC", () => {
    expect(sql).toContain("'unchanged', true");
    expect(sql).toContain("tenant_may_change_payment_frequency is false");
  });
  it("has no destructive statements", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("truncate");
  });
});
