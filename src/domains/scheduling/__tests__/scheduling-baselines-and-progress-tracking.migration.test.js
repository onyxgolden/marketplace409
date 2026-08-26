import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260828000000_add_schedule_baselines_and_progress_tracking.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

const OWNER_SCOPED_TABLES = ["schedule_baselines", "schedule_baseline_blocks"];

describe("scheduling baselines and progress tracking migration", () => {
  it("adds actual_start/actual_finish to schedule_blocks with a date-order check", () => {
    expect(sql).toContain("alter table schedule_blocks add column actual_start date, add column actual_finish date");
    expect(sql).toContain("constraint schedule_blocks_actual_dates_check check (actual_start is null or actual_finish is null or actual_finish >= actual_start)");
  });

  it("creates both new tables", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("gives every new table a composite (owner_id, id) primary key and force RLS with an owner-scoped policy", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const tableStart = sql.indexOf(`create table if not exists ${table}`);
      const tableEnd = sql.indexOf(";", tableStart);
      const tableSql = sql.slice(tableStart, tableEnd);
      expect(tableSql).toContain("owner_id text not null");
      expect(tableSql).toContain("primary key (owner_id, id)");

      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
      expect(sql).toContain(`create policy "${table}_owner_all" on ${table} for all to authenticated using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text)`);
    }
  });

  it("names a baseline uniquely per project", () => {
    expect(sql).toContain("unique (owner_id, schedule_project_id, name)");
    expect(sql).toContain("foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade");
  });

  it("stores schedule_baseline_blocks as a durable snapshot, not a live FK to schedule_blocks", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_baseline_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("block_task_code text not null");
    expect(blocksSql).not.toContain("references schedule_blocks");
    expect(blocksSql).toContain("unique (owner_id, baseline_id, block_task_code)");
    expect(blocksSql).toContain("foreign key (owner_id, baseline_id) references schedule_baselines(owner_id, id) on delete cascade");
  });

  it("captures CPM-relevant columns on the snapshot for a future EVM/DCMA slice to build on", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_baseline_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("block_type text not null check (block_type in ('task', 'milestone', 'hammock'))");
    expect(blocksSql).toContain("baseline_duration_days int not null default 0 check (baseline_duration_days >= 0)");
    expect(blocksSql).toContain("percent_complete smallint not null default 0 check (percent_complete between 0 and 100)");
    expect(blocksSql).toContain("total_float_days int,");
    expect(blocksSql).toContain("is_critical boolean not null default false");
  });

  it("keeps baseline_start/baseline_finish nullable together and in order when both are set", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_baseline_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("check ((baseline_start is null) = (baseline_finish is null))");
    expect(blocksSql).toContain("check (baseline_start is null or baseline_finish is null or baseline_finish >= baseline_start)");
  });

  it("never deletes any existing table or data", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
  });
});
