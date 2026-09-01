import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260829000000_create_workspace_members.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("workspace_members schema migration", () => {
  it("creates the table with a composite primary key", () => {
    expect(sql).toContain("create table if not exists workspace_members");
    expect(sql).toContain("owner_id text not null");
    expect(sql).toContain("primary key (owner_id, id)");
  });

  it("references auth.users for member_user_id and invited_by", () => {
    expect(sql).toContain("member_user_id uuid not null references auth.users(id) on delete cascade");
    expect(sql).toContain("invited_by uuid not null references auth.users(id)");
  });

  it("supports all 5 P6-style roles but structurally forbids inserting a primary_owner row", () => {
    expect(sql).toContain("role text not null check (role in ('primary_owner', 'co_owner', 'manager', 'bookkeeper', 'read_only'))");
    expect(sql).toContain("check (role <> 'primary_owner')");
  });

  it("supports the 3-state membership lifecycle with consistent timestamp requirements", () => {
    expect(sql).toContain("status text not null check (status in ('invited', 'active', 'suspended')) default 'invited'");
    expect(sql).toContain("check (status <> 'invited' or (activated_at is null and suspended_at is null))");
    expect(sql).toContain("check (status <> 'active' or activated_at is not null)");
    expect(sql).toContain("check (status <> 'suspended' or (activated_at is not null and suspended_at is not null))");
  });

  it("enforces one active workspace per member via a partial unique index, not just application logic", () => {
    expect(sql).toContain("create unique index if not exists workspace_members_one_active_workspace_per_member on workspace_members(member_user_id) where status = 'active'");
  });

  it("prevents two membership rows for the same owner/member pair", () => {
    expect(sql).toContain("unique (owner_id, member_user_id)");
  });

  it("enables force row level security with an owner-management policy and a member self-select policy", () => {
    expect(sql).toContain("alter table workspace_members enable row level security");
    expect(sql).toContain("alter table workspace_members force row level security");
    expect(sql).toContain('create policy "workspace_members_owner_all" on workspace_members for all to authenticated using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text)');
    expect(sql).toContain('create policy "workspace_members_self_select" on workspace_members for select to authenticated using (member_user_id = auth.uid())');
  });

  it("never deletes any existing table or data", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
  });
});
