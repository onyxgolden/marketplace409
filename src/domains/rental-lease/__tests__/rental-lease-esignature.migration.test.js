import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917000000_add_lease_esignature.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("lease e-signature migration", () => {
  it("stores one signature per (preparation, version, tenant) -- a new approved version requires fresh signatures", () => {
    expect(sql).toContain("create table if not exists rental_lease_signatures");
    expect(sql).toContain("unique (owner_id, preparation_id, version_number, tenant_id)");
    expect(sql).toContain("version_number integer not null check (version_number > 0)");
  });

  it("protects the table with forced RLS and read-only policies -- no insert/update/delete grant to any role", () => {
    expect(sql).toContain("alter table rental_lease_signatures enable row level security");
    expect(sql).toContain("alter table rental_lease_signatures force row level security");
    expect(sql).toContain('create policy "rental_lease_signatures_owner_select" on rental_lease_signatures for select to authenticated');
    expect(sql).toContain('create policy "rental_lease_signatures_tenant_select" on rental_lease_signatures for select to authenticated');
    expect(sql).not.toMatch(/create policy[^;]*rental_lease_signatures[^;]*for (insert|update|delete)/);
  });

  it("grants the table-level select authenticated needs -- RLS policies alone are not sufficient in Postgres", () => {
    expect(sql).toContain("grant select on table rental_lease_signatures to authenticated");
  });

  it("owner visibility uses workspace access; tenant visibility uses the existing lease-access helper, not a new one", () => {
    expect(sql).toContain("using (has_workspace_access(owner_id))");
    expect(sql).toContain("using (rental_actor_has_lease_access(owner_id, lease_id))");
  });

  it("sign_rental_lease_preparation_version derives owner/tenant identity itself -- the caller cannot supply either", () => {
    expect(sql).toContain("create or replace function sign_rental_lease_preparation_version(");
    expect(sql).toContain("security definer");
    expect(sql).toContain("select * into tenant_record from rental_tenants where auth_user_id = authenticated_user_id");
    expect(sql).not.toContain("p_owner_id");
    expect(sql).not.toContain("p_tenant_id");
  });

  it("rejects signing when there is no linked tenant portal access, or the tenant lacks access to this specific lease", () => {
    expect(sql).toContain("if tenant_record.id is null then raise exception 'no tenant portal access is linked to this account.'");
    expect(sql).toContain("if not rental_actor_has_lease_access(tenant_record.owner_id, p_lease_id) then");
    expect(sql).toContain("raise exception 'active tenant lease access is required.'");
  });

  it("only the currently approved version can be signed -- not a draft, not a superseded version", () => {
    expect(sql).toContain("if prep_record.status <> 'approved' or prep_record.approved_version is distinct from p_version_number then");
    expect(sql).toContain("raise exception 'only the currently approved lease version can be signed.'");
  });

  it("requires a real typed name -- an empty or single-character signature is rejected", () => {
    expect(sql).toContain("if length(btrim(coalesce(p_signer_name, ''))) < 2 then");
    expect(sql).toContain("raise exception 'a typed legal name is required to sign.'");
  });

  it("builds the signing statement server-side, citing the exact version number, never trusting client-supplied text", () => {
    expect(sql).toContain("'by typing my name above, i am signing this lease electronically.");
    expect(sql).toContain("|| p_version_number ||");
    expect(sql).not.toContain("p_signature_statement");
    expect(sql).not.toContain("p_statement");
  });

  it("is idempotent: re-signing an already-signed version is a no-op, not a duplicate row or an error", () => {
    expect(sql).toContain("on conflict (owner_id, preparation_id, version_number, tenant_id) do nothing");
    expect(sql).toContain("if result.id is null then");
  });

  it("reports whether every tenant on the lease has now signed this version", () => {
    expect(sql).toContain("select count(*) into total_tenants from rental_lease_tenants where owner_id = tenant_record.owner_id and lease_id = p_lease_id");
    expect(sql).toContain("'fullyexecuted', signed_tenants >= total_tenants");
  });

  it("limits execution to authenticated callers only", () => {
    expect(sql).toContain("revoke all on function sign_rental_lease_preparation_version(text, text, integer, text, text, text) from public, anon");
    expect(sql).toContain("grant execute on function sign_rental_lease_preparation_version(text, text, integer, text, text, text) to authenticated");
  });

  it("captures IP address and user agent as caller-supplied audit context, not derived from anything spoofable server-side by another tenant", () => {
    expect(sql).toContain("ip_address text");
    expect(sql).toContain("user_agent text");
  });
});
