import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260904231500_add_schedule_baselines_public_select.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("schedule baselines public-select migration", () => {
  it("adds a public-select policy to both baseline tables, matching the pattern used for every other schedule_* table", () => {
    expect(sql).toContain('create policy "schedule_baselines_public_select" on schedule_baselines for select to authenticated');
    expect(sql).toContain('create policy "schedule_baseline_blocks_public_select" on schedule_baseline_blocks for select to authenticated');
  });

  it("joins schedule_baseline_blocks' policy through schedule_baselines, since it has no schedule_project_id column of its own", () => {
    const policy = sql.slice(sql.indexOf('"schedule_baseline_blocks_public_select"'));
    expect(policy).toContain("join schedule_projects sp on sp.owner_id = b.owner_id and sp.id = b.schedule_project_id");
    expect(policy).toContain("b.id = schedule_baseline_blocks.baseline_id");
  });

  it("never touches the existing owner-scoped write policy or drops anything", () => {
    expect(sql).not.toContain("drop policy");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain('create policy "schedule_baselines_owner_all"');
    expect(sql).not.toContain('create policy "schedule_baseline_blocks_owner_all"');
  });
});
