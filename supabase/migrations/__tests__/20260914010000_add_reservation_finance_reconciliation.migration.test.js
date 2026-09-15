import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../20260914010000_add_reservation_finance_reconciliation.sql", import.meta.url), "utf8").toLowerCase();
describe("RV-E2D migration static contract", () => {
  it("is additive and preserves immutable contracts, application and deposit rows", () => {
    expect(sql.match(/create table if not exists/g)).toHaveLength(3);
    expect(sql).not.toMatch(/(?:update|delete from|truncate|alter table) public\.(reservation_financial_contracts|reservation_payment_attempts|reservation_payment_events|reservations)\b/);
    expect(sql).not.toMatch(/insert into public\.(rental_payments|rental_leases|rental_tenants|rent_charges)/);
  });
  it("forces workspace RLS on every new table and exposes no raw mutation grants", () => {
    expect(sql.match(/force row level security/g)).toHaveLength(3);
    expect(sql.match(/using \(public.has_workspace_access\(owner_id\)\)/g)).toHaveLength(3);
    expect(sql).not.toMatch(/grant (?:insert|update|delete|all)/);
    expect(sql.match(/security definer set search_path = public set row_security = off/g)).toHaveLength(3);
    expect(sql).toContain("with (security_invoker = true)");
  });
  it("retains append-only receipts and canonical observations for accepted events", () => {
    for (const table of ["reservation_finance_receipts", "reservation_finance_evidence"]) {
      expect(sql).toContain(`before update or delete on public.${table}`);
    }
    for (const field of ["owner_id", "reservation_id", "payment_attempt_id", "connected_account_id", "provider_mode", "payment_intent_id", "object_id", "amount_cents", "currency_code"]) expect(sql).toContain(field);
    expect(sql).toContain("payload_hash ~ '^[a-f0-9]{64}$'");
  });
  it("serializes events and owners and deduplicates by immutable provider object identity", () => {
    expect(sql).toContain("'reservation-finance:event:'");
    expect(sql).toContain("'reservation-finance:owner:'");
    expect(sql).toContain("'duplicate',true");
    expect(sql).toContain("on conflict (connected_account_id,provider_mode,object_id)");
    expect(sql).toContain("refund_total_mismatch");
    expect(sql).toContain("dispute_total_mismatch");
    expect(sql).toContain("if v_old.kind='reversal' then v_object.kind := 'reversal'");
  });
  it("keeps terminal outcomes, fee arithmetic and canonical mode binding explicit", () => {
    expect(sql).toContain("net_cents = amount_cents - fee_cents");
    expect(sql).toContain("p_provider_mode is distinct from 'test'");
    expect(sql).toContain("provider_reference=v_item->>'paymentintentid'");
    expect(sql).toContain("conflicting_terminal_outcome");
    expect(sql).toContain("conflicting_payout_outcome");
    expect(sql).toContain("payout_association_changed");
    expect(sql).toContain("ambiguous_balance_transaction");
  });
  it("rolls back partially validated batches while retaining safe unknown evidence", () => {
    expect(sql).toContain("exception when others then");
    expect(sql).toContain("'unknown',v_reason");
    expect(sql).not.toContain("sqlerrm");
  });
  it("keeps private guest credentials and revocation authoritative", () => {
    expect(sql).toContain("r.guest_access_token=p_access_token");
    expect(sql).toContain("r.status in ('confirmed','checked_in')");
    expect(sql).toContain("grant execute on function public.get_public_reservation_financial_summary(text,text) to service_role");
  });
});
