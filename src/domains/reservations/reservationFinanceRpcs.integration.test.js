// Opt-in, real PostgreSQL roles/RPCs. This suite NEVER installs a migration, starts a
// stack, disables an immutable trigger, or deletes history. Fixtures roll back.
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
const container = "supabase_db_marketplace409-reservation-validation";
const enabled = process.env.RV_E2D_DISPOSABLE_PROJECT === "marketplace409-reservation-validation";
const owner = "e2d00000-0000-4000-8000-000000000001";
const member = "e2d00000-0000-4000-8000-000000000002";
const stranger = "e2d00000-0000-4000-8000-000000000003";
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
function psql(sql) {
  if (!enabled) throw new Error("An explicitly identified disposable project is required.");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" });
}
const item = { paymentIntentId: "pi_e2d", objectId: "re_e2d", kind: "refund", amountCents: 400, currencyCode: "USD", status: "succeeded" };
function record(id, observations = [item], options = {}) {
  return `select public.record_reservation_finance_event(${quote(id)},${quote(options.account || "acct_e2d")},${quote(options.mode || "test")},
    ${quote(options.type || "refund.updated")},'re_e2d',repeat('a',64),${quote(options.at || "2026-09-14T12:00:00Z")},
    ${quote(JSON.stringify(observations))}::jsonb,${options.unknown ? "'unknown'" : "null"});`;
}
const setup = `begin;
  insert into auth.users(id,email) values ('${owner}','rv-e2d-owner@example.test'),('${member}','rv-e2d-member@example.test'),('${stranger}','rv-e2d-stranger@example.test');
  insert into public.workspace_members(owner_id,id,member_user_id,role,status,invited_email,invited_by,activated_at)
    values ('${owner}','e2d-member','${member}','co_owner','active','rv-e2d-member@example.test','${owner}',now());
  select set_config('request.jwt.claim.sub','${owner}',true);
  set local role authenticated;
  select public.import_reservation_inventory_bulk('${owner}','e2d-import','e2d-digest',
    '[{"unitId":"e2d-unit","propertyId":"e2d-property","unitLabel":"Test","publicName":"Test","inventoryType":"rv_site","bookingStatus":"active","timezone":"America/Chicago","maximumGuests":2,"minimumNights":1,"turnoverBufferHours":0,"amenities":[],"cleaningFeeCents":0,"securityDepositCents":500,"lodgingTaxBasisPoints":0,"nightlyRateCents":1000,"effectiveStartDate":"2026-01-01","ratePlanId":"e2d-rate"}]'::jsonb);
  select public.confirm_owner_reservation('${owner}','e2d-reservation','e2d-guest','e2d-unit','Test Guest','rv-e2d-guest@example.test',null,
    '2027-05-01','2027-05-02',1,1000,0,0,500,1500,'USD','e2d-source',null);
  reset role;
  insert into public.landlord_payment_accounts(owner_id,id,provider,provider_mode,provider_account_id,status,details_submitted,charges_enabled,payouts_enabled,ach_debit_enabled,card_payments_enabled)
    values ('${owner}','e2d-account','stripe','test','acct_e2d','enabled',true,true,true,false,true);
  insert into public.reservation_payment_attempts(owner_id,id,reservation_id,guest_id,purpose,provider,provider_mode,provider_reference,idempotency_key,amount_cents,currency_code,payment_status)
    values ('${owner}','reservation_payment_e2d','e2d-reservation','e2d-guest','booking_balance','stripe','test','pi_e2d','e2d-key',1000,'USD','pending');
  set local role service_role;
  select public.process_stripe_reservation_payment_event('evt_e2d_application','acct_e2d','payment_intent.succeeded','reservation_payment_e2d','pi_e2d',1000,'USD',null,now(),'test');
`;
function run(statements, selection) {
  const output = psql(`${setup}${statements} reset role; select 'RESULT:' || (${selection})::text; rollback;`);
  return JSON.parse(output.split("\n").find(line => line.startsWith("RESULT:")).slice(7));
}
describe.skipIf(!enabled)("RV-E2D real disposable PostgreSQL role and RPC contract (migration preinstalled)", () => {
  beforeAll(() => {
    const project = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container], { encoding: "utf8" }).trim();
    expect(project).toBe("marketplace409-reservation-validation");
    expect(psql("select to_regclass('public.reservation_finance_objects') is not null;").trim()).toBe("t");
  });
  it("deduplicates event IDs and distinct events describing the same cumulative refund", () => {
    const result = run(record("evt_e2d_refund") + record("evt_e2d_refund") + record("evt_e2d_repeat"),
      "select jsonb_build_object('objects',(select count(*) from reservation_finance_objects),'evidence',(select count(*) from reservation_finance_evidence),'refund',(select finance_refunded_cents from reservation_finance_summary where owner_id='" + owner + "'))");
    expect(result).toEqual({ objects: 1, evidence: 2, refund: 400 });
  });
  it("recognizes late reversal classification without double-counting the refund", () => {
    const result = run(record("evt_e2d_refund_first") + record("evt_e2d_reversal_later", [{ ...item, kind: "reversal" }]),
      `select jsonb_build_object('refund',finance_refunded_cents,'reversed',reversed_cents) from reservation_finance_summary where owner_id='${owner}'`);
    expect(result).toEqual({ refund: 400, reversed: 400 });
  });
  it("preserves application and deposit after full refund, payout and delayed settlement", () => {
    const settlement = { ...item, objectId: "txn_e2d", kind: "settlement", amountCents: 1000, status: "available", feeCents: 30, netCents: 970 };
    const result = run(record("evt_e2d_available", [settlement], { type: "charge.updated" })
      + record("evt_e2d_paid", [{ ...settlement, payoutId: "po_e2d", payoutStatus: "paid" }], { type: "payout.paid" })
      + record("evt_e2d_late", [{ ...settlement, status: "pending" }], { type: "charge.updated", at: "2026-09-13T12:00:00Z" })
      + record("evt_e2d_full", [{ ...item, amountCents: 1000 }]),
      `select jsonb_build_object('paid',booking_applied_cents,'deposit',security_deposit_cents,'refund',finance_refunded_cents,'settlement',finance_settlement_status,'payout',payout_status,'historical',historical_paid_out_cents) from reservation_finance_summary where owner_id='${owner}'`);
    expect(result).toEqual({ paid: 1000, deposit: 500, refund: 1000, settlement: "available", payout: "paid_out", historical: 970 });
  });
  it.each(["won", "lost"])("does not regress dispute %s on a delayed created event", status => {
    const dispute = { ...item, objectId: "dp_e2d", kind: "dispute", amountCents: 1000, status };
    const result = run(record("evt_e2d_closed", [dispute], { type: "charge.dispute.closed" })
      + record("evt_e2d_created", [{ ...dispute, status: "needs_response" }], { type: "charge.dispute.created", at: "2026-09-13T12:00:00Z" }),
      `select to_jsonb(dispute_status) from reservation_finance_summary where owner_id='${owner}'`);
    expect(result).toBe(status);
  });
  it.each([
    [{ ...item, currencyCode: "EUR" }, {}], [{ ...item, amountCents: 1001 }, {}],
    [{ ...item, paymentIntentId: "pi_unknown" }, {}], [item, { account: "acct_unknown" }],
    [item, { mode: "live" }], [item, { type: "unsupported" }], [item, { unknown: true }],
  ])("fails closed for invalid evidence with immutable unknown receipt", (observation, options) => {
    expect(run(record("evt_e2d_unknown", [observation], options),
      "select jsonb_build_object('objects',(select count(*) from reservation_finance_objects),'outcome',(select outcome from reservation_finance_receipts where provider_event_id='evt_e2d_unknown'))"))
      .toEqual({ objects: 0, outcome: "unknown" });
  });
  it("rolls back a partly valid batch when cumulative refunds exceed payment", () => {
    expect(run(record("evt_e2d_excess", [item, { ...item, objectId: "re_second", amountCents: 700 }]),
      "select jsonb_build_object('objects',(select count(*) from reservation_finance_objects),'evidence',(select count(*) from reservation_finance_evidence))"))
      .toEqual({ objects: 0, evidence: 0 });
  });
  it.each([owner, member, stranger])("enforces canonical workspace reads for actor %s", actor => {
    const output = psql(`${setup}${record("evt_e2d_read")} reset role;
      select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated;
      select 'COUNT:' || count(*) from public.reservation_finance_evidence where owner_id='${owner}'; rollback;`);
    expect(output).toContain(`COUNT:${actor === stranger ? 0 : 1}`);
  });
  it.each(["anon", "authenticated"])("denies mutation RPC execution to %s", role => {
    expect(() => psql(`${setup} reset role; set local role ${role}; ${record("evt_e2d_denied")} rollback;`)).toThrow(/permission denied/);
  });
  it("rejects evidence rewrite even as database owner", () => {
    expect(() => psql(`${setup}${record("evt_e2d_immutable")} reset role;
      update public.reservation_finance_evidence set amount_cents=1 where provider_event_id='evt_e2d_immutable'; rollback;`)).toThrow(/immutable/);
  });
});
