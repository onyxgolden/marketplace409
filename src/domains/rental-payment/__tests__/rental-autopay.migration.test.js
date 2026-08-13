import{readFileSync}from"node:fs";import{describe,expect,it}from"vitest";
const sql=readFileSync("supabase/migrations/20260813002800_create_rental_autopay_controls.sql","utf8");
describe("rental autopay migration",()=>{
it("keeps provider activation separate from tenant consent",()=>{expect(sql).toContain("status in ('setup_required','active','paused','cancelled')");expect(sql).toContain("provider_mandate_id");expect(sql).not.toMatch(/status,'active'/);});
it("preserves consent and cancellation evidence",()=>{expect(sql).toContain("consent_text text not null");expect(sql).toContain("consented_at timestamptz not null");expect(sql).toContain("cancelled_at timestamptz");});
it("limits tenant access to their identity",()=>{expect(sql).toContain("tenant.auth_user_id=auth.uid()");expect(sql).toContain("rental_autopay_tenant_read");});
it("prevents duplicate current enrollment",()=>{expect(sql).toContain("rental_autopay_one_current_enrollment");});
});
