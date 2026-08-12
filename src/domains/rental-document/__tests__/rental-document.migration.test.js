import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260812001900_create_rental_document_library.sql"),"utf8").toLowerCase();
describe("rental document library migration",()=>{
  it("creates a private constrained document bucket",()=>{ expect(sql).toContain("'rental-documents', 'rental-documents', false"); expect(sql).toContain("10485760"); });
  it("ties every document to an owner-scoped lease",()=>{ expect(sql).toContain("foreign key(owner_id,lease_id) references rental_leases(owner_id,id)"); expect(sql).toContain("split_part(object_path,'/',1)=owner_id"); });
  it("allows tenant reads only for published lease documents",()=>{ expect(sql).toContain("document.tenant_visible"); expect(sql).toContain("rental_actor_has_lease_access(document.owner_id,document.lease_id)"); });
  it("does not grant tenant upload, update, or delete access",()=>{ expect(sql).not.toContain("rental_document_objects_tenant_insert"); expect(sql).not.toContain("rental_documents_tenant_update"); });
});
