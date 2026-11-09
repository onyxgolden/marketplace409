import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260902000100_add_user_workspace_preferences.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");
const favoriteSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261108220000_add_work_packages_favorite_workspace.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("user workspace preferences migration", () => {
  it("is keyed one row per user, cascading on account deletion", () => {
    expect(sql).toContain("create table public.user_workspace_preferences");
    expect(sql).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
  });

  it("only allows a favorite from the known set of top-level workspaces plus the private health shortcut", () => {
    expect(sql).toContain("favorite_workspace_id text check");
    expect(sql).toContain("'marketplace', 'rentals', 'forge', 'scheduling', 'dev', 'health'");
  });

  it("is private to the signed-in user via forced RLS, not just an application-level convention", () => {
    expect(sql).toContain("alter table public.user_workspace_preferences enable row level security");
    expect(sql).toContain("alter table public.user_workspace_preferences force row level security");
    expect(sql).toContain("using (user_id = auth.uid())");
    expect(sql).toContain("with check (user_id = auth.uid())");
  });
});

describe("user workspace preferences favorite expansion (work-packages tile)", () => {
  it("adds 'work-packages' to the favorite allowlist without dropping the existing ids", () => {
    expect(favoriteSql).toContain("drop constraint if exists user_workspace_preferences_favorite_workspace_id_check");
    expect(favoriteSql).toContain("'marketplace', 'rentals', 'forge', 'scheduling', 'dev', 'health', 'work-packages'");
  });
});
