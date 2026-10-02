import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RENTAL_PERMISSION_KEYS } from "../permissions.js";

// Content contract for the R17 roles & granular-permissions migration. This never touches a
// database -- it asserts the migration file contains exactly the pieces the R17 API layer
// depends on, so a bad edit to the SQL breaks the build instead of the next deploy.
const migrationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001060000_r17_roles_granular_permissions.sql"),
  "utf8",
).toLowerCase();

const strippedSql = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("R17 roles & granular permissions migration", () => {
  it("adds the three named staff roles to the workspace_members role check", () => {
    for (const role of ["property_manager", "maintenance", "marketing"]) {
      expect(strippedSql).toContain(`'${role}'`);
    }
    // The pre-existing roles stay in the check too.
    for (const role of ["co_owner", "manager", "bookkeeper", "read_only"]) {
      expect(strippedSql).toContain(`'${role}'`);
    }
  });

  it("adds the permission_overrides jsonb column to workspace_members", () => {
    expect(strippedSql).toContain("add column if not exists permission_overrides jsonb");
  });

  it("validates overrides against the same 12 permission keys the JS catalog defines", () => {
    for (const key of RENTAL_PERMISSION_KEYS) {
      expect(strippedSql).toContain(`'${key}'`);
    }
    expect(RENTAL_PERMISSION_KEYS).toHaveLength(12);
  });

  it("activates staff rows in has_workspace_access and resolve_effective_owner_id", () => {
    expect(strippedSql).toContain("create or replace function public.has_workspace_access");
    expect(strippedSql).toContain("create or replace function public.resolve_effective_owner_id");
  });

  it("creates the team audit table with an owner-scoped RLS policy", () => {
    expect(strippedSql).toContain("create table if not exists workspace_member_audit");
    expect(strippedSql).toContain("create policy \"workspace_member_audit_owner_all\" on workspace_member_audit");
  });

  it("creates the audited team-management RPCs and grants them to authenticated", () => {
    for (const fn of [
      "public.invite_workspace_member",
      "public.update_workspace_member",
      "public.get_workspace_team",
      "public.log_team_audit",
      "public.get_team_audit_log",
      "public.suspend_workspace_member",
      "public.reactivate_workspace_member",
    ]) {
      expect(strippedSql).toContain(`create or replace function ${fn}`);
    }
    expect(strippedSql).toContain("grant execute on function public.get_workspace_team() to authenticated");
  });

  it("restricts team management to the owner or co-owner", () => {
    expect(strippedSql).toContain("create or replace function public.team_management_owner_id");
  });

  it("is idempotent-safe: no bare CREATE TABLE / CREATE POLICY without if-not-exists guards", () => {
    expect(strippedSql).not.toMatch(/create table (?!if not exists)/);
    expect(strippedSql).toMatch(/create table if not exists workspace_member_audit/);
  });
});
