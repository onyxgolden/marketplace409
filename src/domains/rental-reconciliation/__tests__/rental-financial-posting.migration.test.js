import{readFileSync}from"node:fs";import{resolve}from"node:path";import{describe,expect,it}from"vitest";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260812002100_post_rental_payments_to_financial_events.sql"),"utf8").toLowerCase();
describe("rental financial posting",()=>{it("posts only succeeded rent payments as noi income",()=>{expect(sql).toContain("new.status<>'succeeded'");expect(sql).toContain("'income','rental_income'");expect(sql).toContain("false,true,false");});
it("is idempotent by owner and rental payment id",()=>{expect(sql).toContain("'forge_rental_payment',new.id");expect(sql).toContain("on conflict(owner_id,source_system,source_record_id) do nothing");});
it("backfills already succeeded payments",()=>{expect(sql).toContain("from rental_payments payment join rental_leases lease");expect(sql).toContain("where payment.status='succeeded'");});});
