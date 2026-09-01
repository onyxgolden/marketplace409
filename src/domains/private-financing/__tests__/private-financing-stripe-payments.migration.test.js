import{readFileSync}from"node:fs";import{resolve}from"node:path";import{describe,expect,it}from"vitest";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260831000200_add_private_financing_stripe_payments.sql"),"utf8").toLowerCase().replace(/\s+/g," ");
describe("private financing Stripe payments migration",()=>{
it("defaults every account to paused and fee reimbursement enabled",()=>{expect(sql).toContain("enabled boolean not null default false");expect(sql).toContain("reimburse_stripe_fee_as_principal_credit boolean not null default true");});
it("permits only service role to finalize Stripe ledger writes",()=>{expect(sql).toContain("if auth.role()<>'service_role'");expect(sql).toContain("grant execute on function complete_private_financing_stripe_payment");expect(sql).toContain("to service_role");expect(sql).toContain("from public,anon,authenticated");});
it("serializes against the account ledger sequence and atomically records success",()=>{expect(sql).toContain("for update");expect(sql).toContain("if v_seq<>p_expected_ledger_sequence");expect(sql).toContain("'payment_posted','stripe_webhook'");expect(sql).toContain("status='succeeded',ledger_event_id=v_event_id");});
it("makes the actual Stripe fee a separate principal credit exactly once",()=>{expect(sql).toContain("fee_credit_event_id is not null");expect(sql).toContain("'principal_correction','stripe_webhook'");expect(sql).toContain("'discretionary_concession',-p_fee_cents");});
});
