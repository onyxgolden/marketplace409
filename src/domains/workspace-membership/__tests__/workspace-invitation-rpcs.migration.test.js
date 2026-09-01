import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260829000200_add_workspace_invitation_rpcs.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("workspace invitation RPCs migration", () => {
  it("defines all 4 RPCs as security definer", () => {
    for (const name of ["invite_workspace_member", "accept_workspace_invitation", "suspend_workspace_member", "reactivate_workspace_member"]) {
      expect(sql).toContain(`create or replace function public.${name}`);
    }
    const functionDefinitionCount = (sql.match(/create or replace function/g) || []).length;
    expect(functionDefinitionCount).toBe(4);
    const securityDefinerCount = (sql.match(/security definer/g) || []).length;
    expect(securityDefinerCount).toBe(4);
  });

  it("invite_workspace_member resolves the invitee's auth.users.id server-side by email, never from a parameter", () => {
    const start = sql.indexOf("create or replace function public.invite_workspace_member");
    const end = sql.indexOf("create or replace function public.accept_workspace_invitation");
    const body = sql.slice(start, end);
    expect(body).toContain("select users.id, users.email_confirmed_at into invitee_user_id, invitee_confirmed_at from auth.users users where lower(nullif(btrim(users.email), '')) = normalized_email");
    expect(body).toContain("no existing account was found for that email address");
    expect(body).toContain("that account has not confirmed its email address yet");
  });

  it("invite_workspace_member rejects self-invitation and non-co_owner roles", () => {
    const start = sql.indexOf("create or replace function public.invite_workspace_member");
    const end = sql.indexOf("create or replace function public.accept_workspace_invitation");
    const body = sql.slice(start, end);
    expect(body).toContain("you cannot invite yourself");
    expect(body).toContain("if p_role <> 'co_owner' then raise exception 'only co_owner invitations are supported in this release.'");
  });

  it("invite_workspace_member blocks inviting a user who already has an active membership elsewhere", () => {
    const start = sql.indexOf("create or replace function public.invite_workspace_member");
    const end = sql.indexOf("create or replace function public.accept_workspace_invitation");
    const body = sql.slice(start, end);
    expect(body).toContain("that user already has an active workspace membership elsewhere");
  });

  it("accept_workspace_invitation derives identity purely from auth.uid(), takes no parameters", () => {
    expect(sql).toContain("create or replace function public.accept_workspace_invitation() returns workspace_members");
    const start = sql.indexOf("create or replace function public.accept_workspace_invitation");
    const end = sql.indexOf("create or replace function public.suspend_workspace_member");
    const body = sql.slice(start, end);
    expect(body).toContain("where member_user_id = authenticated_user_id and status = 'invited'");
    expect(body).toContain("no pending workspace invitation was found for this account");
  });

  it("suspend and reactivate are scoped to the caller's own owner_id, matching the owner-management RLS pattern", () => {
    const start = sql.indexOf("create or replace function public.suspend_workspace_member");
    const end = sql.indexOf("revoke all");
    const body = sql.slice(start, end);
    expect(body).toContain("where owner_id = owner_id_value and id = p_member_id and status = 'active'");
    expect(body).toContain("where owner_id = owner_id_value and id = p_member_id and status = 'suspended'");
  });

  it("revokes public execute and grants only to authenticated for all 4 RPCs", () => {
    for (const [name, args] of [["invite_workspace_member", "text, text"], ["accept_workspace_invitation", ""], ["suspend_workspace_member", "text"], ["reactivate_workspace_member", "text"]]) {
      expect(sql).toContain(`revoke all on function public.${name}(${args}) from public`);
      expect(sql).toContain(`grant execute on function public.${name}(${args}) to authenticated`);
    }
  });

  it("never deletes any existing table, data, or function", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("drop function");
  });
});
