import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20260926120000_rental_payment_deposit_state.sql.
// This test never touches a database: it proves the migration text carries the
// Slice D contract — explicit deposit state on every rental payment, a
// reversible transition, and automatic deposit marking when Stripe pays out.
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260926120000_rental_payment_deposit_state.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rental payment deposit_state migration — structural contract", () => {
  it("adds the deposit_state column constrained to received/deposited, defaulting to received", () => {
    expect(sql).toContain("alter table rental_payments add column if not exists deposit_state text not null default 'received' check (deposit_state in ('received', 'deposited'))");
  });

  it("adds the deposited_at timestamp", () => {
    expect(sql).toContain("alter table rental_payments add column if not exists deposited_at timestamptz");
  });

  it("adds the deposit_state_manual_at timestamp so the payout hook can't overwrite a newer manual decision", () => {
    expect(sql).toContain("alter table rental_payments add column if not exists deposit_state_manual_at timestamptz");
  });

  it("adds an owner-scoped index over the money-moving payment statuses", () => {
    expect(sql).toContain("create index if not exists idx_rental_payments_deposit_state on rental_payments (owner_id, deposit_state)");
    expect(sql).toContain("where status in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded')");
  });

  it("backfills historical completed payments as deposited (owner decision: pre-migration money is treated as banked, not re-queued)", () => {
    expect(sql).toContain("set deposit_state = 'deposited', deposited_at = coalesce(succeeded_at, received_at, created_at)");
    expect(sql).toContain("where deposit_state = 'received' and status in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded')");
  });

  it("replaces record_offline_rental_payment with the 11-argument version carrying p_deposit_state", () => {
    expect(sql).toContain("drop function if exists record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text)");
    expect(sql).toContain("p_deposit_state text default 'received'");
    expect(sql).toContain("if v_deposit_state not in ('received', 'deposited') then raise exception 'unsupported deposit state.'");
    expect(sql).toContain("v_deposit_state, case when v_deposit_state = 'deposited' then now() else null end");
    expect(sql).toContain("'depositstate', v_deposit_state");
  });

  it("idempotent replay returns the originally stored deposit state, never a retry's new value", () => {
    expect(sql).toContain("'depositstate', v_existing_payment.deposit_state");
    expect(sql).toContain("'depositedat', v_existing_payment.deposited_at");
  });

  it("adds the reversible set_rental_payment_deposit_state transition, owner-scoped and money-gated", () => {
    expect(sql).toContain("create or replace function set_rental_payment_deposit_state( p_owner_id text, p_payment_id text, p_deposit_state text )");
    expect(sql).toContain("if v_state not in ('received', 'deposited') then raise exception 'unsupported deposit state.'");
    expect(sql).toContain("select * into v_payment from rental_payments where owner_id = p_owner_id and id = p_payment_id for update");
    expect(sql).toContain("if v_payment.status not in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded') then raise exception 'only a payment that moved money can be marked deposited.'");
    expect(sql).toContain("set deposit_state = v_state, deposited_at = case when v_state = 'deposited' then now() else null end, deposit_state_manual_at = now(), updated_at = now()");
    expect(sql).toContain("'changed', false");
    expect(sql).toContain("'changed', true");
  });

  it("stamps deposit_state_manual_at on every owner-driven transition", () => {
    expect(sql).toContain("deposit_state_manual_at = now()");
  });

  it("replaces the current six-argument provider-mode payout RPC and marks linked payments deposited", () => {
    expect(sql).toContain("create or replace function mark_stripe_rental_settlements_paid_out(");
    expect(sql).toContain("if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception");
    expect(sql).toContain("update rental_payments set deposit_state='deposited',deposited_at=coalesce(deposited_at,p_paid_out_at),updated_at=now()");
    expect(sql).toContain("where owner_id=v_owner and (deposit_state_manual_at is null or deposit_state_manual_at < p_paid_out_at) and id in(select payment_id from rental_settlements where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_payout_id=p_payout_id)");
  });

  it("payout hook never overwrites a manual decision newer than the payout", () => {
    expect(sql).toContain("where owner_id=v_owner and (deposit_state_manual_at is null or deposit_state_manual_at < p_paid_out_at) and id in(select payment_id from rental_settlements");
  });

  it("keeps the recorder and transition RPCs authenticated-role only; the payout hook stays service_role only", () => {
    expect(sql).toContain("revoke all on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text, text) from public, anon");
    expect(sql).toContain("grant execute on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text, text) to authenticated");
    expect(sql).toContain("revoke all on function set_rental_payment_deposit_state(text, text, text) from public, anon");
    expect(sql).toContain("grant execute on function set_rental_payment_deposit_state(text, text, text) to authenticated");
    expect(sql).toContain("revoke all on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text)from public,anon,authenticated");
    expect(sql).toContain("grant execute on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text)to service_role");
  });
});
