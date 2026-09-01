import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("workspace authorization helpers migration", () => {
  it("defines has_workspace_access with both text and uuid overloads", () => {
    expect(sql).toContain("create or replace function public.has_workspace_access(p_owner_id text)");
    expect(sql).toContain("create or replace function public.has_workspace_access(p_owner_id uuid)");
    expect(sql).toContain("select public.has_workspace_access(p_owner_id::text)");
  });

  it("has_workspace_access(text) checks primary-owner equality OR an active co_owner membership", () => {
    expect(sql).toContain("select p_owner_id = auth.uid()::text or exists ( select 1 from workspace_members where owner_id = p_owner_id and member_user_id = auth.uid() and status = 'active' and role = 'co_owner' )");
  });

  it("defines resolve_effective_owner_id defaulting to auth.uid(), falling back to the actor's own id", () => {
    expect(sql).toContain("create or replace function public.resolve_effective_owner_id(p_actor uuid default auth.uid())");
    expect(sql).toContain("returns text");
    expect(sql).toContain("select coalesce( (select owner_id from workspace_members where member_user_id = p_actor and status = 'active' and role = 'co_owner' limit 1), p_actor::text )");
  });

  it("all three helpers are security definer with row_security off, matching the established rental_actor_has_* pattern", () => {
    const functionDefinitionCount = (sql.match(/create or replace function/g) || []).length;
    expect(functionDefinitionCount).toBe(3);
    const rowSecurityOffOccurrences = sql.split("set row_security = off").length - 1;
    expect(rowSecurityOffOccurrences).toBe(3);
  });

  it("revokes public execute and grants only to authenticated", () => {
    expect(sql).toContain("revoke all on function public.has_workspace_access(text) from public");
    expect(sql).toContain("revoke all on function public.has_workspace_access(uuid) from public");
    expect(sql).toContain("revoke all on function public.resolve_effective_owner_id(uuid) from public");
    expect(sql).toContain("grant execute on function public.has_workspace_access(text) to authenticated");
    expect(sql).toContain("grant execute on function public.has_workspace_access(uuid) to authenticated");
    expect(sql).toContain("grant execute on function public.resolve_effective_owner_id(uuid) to authenticated");
  });

  it("never deletes any existing table or data", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("drop function");
  });
});
