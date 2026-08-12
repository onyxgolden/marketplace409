import { describe,expect,it } from "vitest";import fs from "node:fs";import path from "node:path";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260812002400_create_rental_inspections.sql"),"utf8");
describe("rental inspection migration",()=>{
it("stores inspections, item evidence, and acknowledgements separately",()=>{expect(sql).toContain("create table if not exists rental_inspections");expect(sql).toContain("create table if not exists rental_inspection_items");expect(sql).toContain("create table if not exists rental_inspection_acknowledgements");});
it("keeps tenant visibility limited to finalized records",()=>expect(sql).toContain("status in ('finalized','acknowledged')"));
it("does not automatically create deposit deductions",()=>{expect(sql).toContain("deposit_review_recommended");expect(sql).not.toContain("record_rental_security_deposit_transaction(");});
it("uses a narrowly checked definer function because tenants cannot update owner records",()=>{expect(sql).toContain("acknowledge_rental_inspection(p_inspection_id text)\nreturns jsonb language plpgsql security definer");expect(sql).toContain("v_tenant_id<>v_inspection.tenant_id");});
it("states acknowledgement is not agreement",()=>expect(sql).toContain("acknowledgement is not agreement"));});
