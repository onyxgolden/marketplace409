import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260821000100_add_provider_mode_to_stripe_rpcs.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

const RPCS = [
  { name: "process_stripe_rental_payment_event", oldSig: "text,text,text,text,text,text,text,timestamptz", newSig: "text,text,text,text,text,text,text,timestamptz,text" },
  { name: "process_stripe_rental_refund_event", oldSig: "text,text,text,bigint,timestamptz", newSig: "text,text,text,bigint,timestamptz,text" },
  { name: "mark_stripe_rental_settlements_paid_out", oldSig: "text,text,text,text[],timestamptz", newSig: "text,text,text,text[],timestamptz,text" },
  { name: "record_stripe_rental_settlement", oldSig: "text,text,text,text,bigint,bigint,bigint,text,text,timestamptz", newSig: "text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,text" },
  { name: "activate_rental_autopay_from_payment", oldSig: "text,text,text,text", newSig: "text,text,text,text,text" },
];

describe("Stripe RPC provider_mode migration — all five functions", () => {
  it.each(RPCS)("drops the old signature of $name before recreating it", ({ name, oldSig }) => {
    expect(sql).toContain(`drop function if exists ${name}(${oldSig.toLowerCase()})`);
  });

  it.each(RPCS)("$name accepts p_provider_mode and remains service_role only", ({ name, newSig }) => {
    expect(sql).toContain("p_provider_mode text");
    expect(sql).toContain(`revoke all on function ${name}(${newSig.toLowerCase()}) from public,anon,authenticated`);
    expect(sql).toContain(`grant execute on function ${name}(${newSig.toLowerCase()}) to service_role`);
  });

  it("every function fails closed on a null OR invalid provider mode (not just an invalid one)", () => {
    // NULL NOT IN (...) evaluates to NULL, not TRUE, in Postgres — a bare `not in` guard would
    // silently let a NULL provider_mode through instead of raising. Every guard must check
    // `is null` explicitly.
    const guardCount = (sql.match(/if p_provider_mode is null or p_provider_mode not in \('test','live'\) then raise exception/g) || []).length;
    expect(guardCount).toBe(5);
    expect(sql).not.toContain("if p_provider_mode not in ('test','live') then raise exception");
  });

  it("scopes every landlord_payment_accounts lookup by provider_mode, not just provider_account_id", () => {
    const count = (sql.match(/from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id/g) || []).length
      + (sql.match(/from landlord_payment_accounts\s*where provider = 'stripe' and provider_mode = p_provider_mode and provider_account_id = p_connected_account_id/g) || []).length;
    expect(count).toBe(5);
  });

  it("process_stripe_rental_payment_event scopes both the event lookup and the payment lookup by provider_mode", () => {
    expect(sql).toContain("from payment_webhook_events where provider = 'stripe' and provider_mode = p_provider_mode and provider_event_id = p_provider_event_id for update");
    expect(sql).toContain("from rental_payments where owner_id = v_owner_id and id = p_payment_id and provider_mode = p_provider_mode for update");
  });

  it("process_stripe_rental_refund_event scopes the payment lookup by provider_mode — a live refund cannot mutate a test payment", () => {
    expect(sql).toContain("from rental_payments where owner_id=v_owner_id and id=p_payment_id and provider_mode=p_provider_mode for update");
  });

  it("mark_stripe_rental_settlements_paid_out scopes the settlement update by provider_mode — a live payout cannot mark a test settlement paid", () => {
    expect(sql).toContain("where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_balance_transaction_id=any(p_balance_transaction_ids)");
  });

  it("record_stripe_rental_settlement scopes the payment lookup by provider_mode and the conflict target matches the widened unique constraint", () => {
    expect(sql).toContain("from rental_payments where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_payment_id=p_payment_intent_id");
    expect(sql).toContain("on conflict(provider,provider_mode,provider_balance_transaction_id) do update");
  });

  it("activate_rental_autopay_from_payment scopes both the payment lookup and the enrollment lookup by provider_mode", () => {
    expect(sql).toContain("from rental_payments where owner_id=p_owner_id and id=p_payment_id and provider_mode=p_provider_mode");
    expect(sql).toContain("and status='setup_required' and provider_mode=p_provider_mode order by consented_at desc limit 1");
  });

  it("never rewrites unrelated business logic — the succeeded/payment-method gate is unchanged", () => {
    expect(sql).toContain("if p.status<>'succeeded' or p_payment_method_id is null then return jsonb_build_object('activated',false)");
  });
});
