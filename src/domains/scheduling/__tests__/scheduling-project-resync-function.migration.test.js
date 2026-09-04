import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260904230000_add_schedule_project_resync_function.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("schedule project resync function migration", () => {
  it("adds next_id, next_task_number and client_metadata to schedule_projects without dropping/recreating the table", () => {
    expect(sql).toContain("alter table schedule_projects");
    expect(sql).toContain("add column if not exists next_id integer not null default 1");
    expect(sql).toContain("add column if not exists next_task_number integer not null default 1010");
    expect(sql).toContain("add column if not exists client_metadata jsonb not null default '{}'::jsonb");
    expect(sql).not.toContain("drop table");
  });

  it("adds a public-select policy to every relational table lacking schedule_projects' is_public carve-out, so the shared example project isn't silently empty for non-owners once these tables are read directly", () => {
    const publicSelectTables = [
      "schedule_calendars", "schedule_calendar_holidays", "schedule_wbs_nodes",
      "schedule_blackout_windows", "schedule_lanes", "schedule_blocks",
      "schedule_dependencies", "schedule_hammock_anchors",
    ];
    for (const table of publicSelectTables) {
      expect(sql).toContain(`create policy "${table}_public_select" on ${table} for select to authenticated`);
    }
  });

  it("joins schedule_dependencies/schedule_hammock_anchors' public-select policy through schedule_blocks, since neither has its own schedule_project_id column", () => {
    const dependenciesPolicy = sql.slice(sql.indexOf('"schedule_dependencies_public_select"'), sql.indexOf('"schedule_hammock_anchors_public_select"'));
    expect(dependenciesPolicy).toContain("join schedule_projects sp on sp.owner_id = b.owner_id and sp.id = b.schedule_project_id");
    expect(dependenciesPolicy).toContain("b.id = schedule_dependencies.predecessor_id");
  });

  it("enforces the ownership boundary explicitly, since security definer bypasses RLS", () => {
    const functionBody = sql.slice(sql.indexOf("create or replace function sync_schedule_project_from_board"), sql.indexOf("$$;"));
    expect(functionBody).toContain("security definer");
    expect(functionBody).toContain("auth.uid() is not null and p_owner_id <> auth.uid()::text");
  });

  it("revokes public execute and grants only to authenticated", () => {
    expect(sql).toContain("revoke all on function sync_schedule_project_from_board(text, text) from public");
    expect(sql).toContain("grant execute on function sync_schedule_project_from_board(text, text) to authenticated");
  });

  it("clears dependents before parents: dependencies/hammock_anchors before blocks, blocks before lanes/wbs_nodes, default_calendar_id nulled before calendars", () => {
    const dependenciesDeleteIndex = sql.indexOf("delete from schedule_dependencies");
    const hammockDeleteIndex = sql.indexOf("delete from schedule_hammock_anchors");
    const blocksDeleteIndex = sql.indexOf("delete from schedule_blocks");
    const lanesDeleteIndex = sql.indexOf("delete from schedule_lanes");
    const wbsNodesDeleteIndex = sql.indexOf("delete from schedule_wbs_nodes");
    const nullDefaultCalendarIndex = sql.indexOf("set default_calendar_id = null");
    const calendarsDeleteIndex = sql.indexOf("delete from schedule_calendars");

    expect(dependenciesDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(hammockDeleteIndex).toBeGreaterThan(dependenciesDeleteIndex);
    expect(blocksDeleteIndex).toBeGreaterThan(hammockDeleteIndex);
    expect(lanesDeleteIndex).toBeGreaterThan(blocksDeleteIndex);
    expect(wbsNodesDeleteIndex).toBeGreaterThan(lanesDeleteIndex);
    expect(nullDefaultCalendarIndex).toBeGreaterThan(wbsNodesDeleteIndex);
    expect(calendarsDeleteIndex).toBeGreaterThan(nullDefaultCalendarIndex);
  });

  it("upserts the project row (do update), unlike the original insert-only backfill -- this function must actually refresh an already-synced project", () => {
    const upsertSection = sql.slice(sql.indexOf("insert into schedule_projects"), sql.indexOf("insert into schedule_calendars"));
    expect(upsertSection).toContain("on conflict (owner_id, id) do update set");
    expect(upsertSection).not.toContain("do nothing");
  });

  it("packs weekWidth/categoryNames/starterChips/customChips into client_metadata rather than inventing a column per field", () => {
    const upsertSection = sql.slice(sql.indexOf("insert into schedule_projects"), sql.indexOf("insert into schedule_calendars"));
    expect(upsertSection).toContain("jsonb_build_object(");
    expect(upsertSection).toContain("'weekwidth', fsp.board -> 'weekwidth'");
    expect(upsertSection).toContain("'categorynames'");
    expect(upsertSection).toContain("'starterchips'");
    expect(upsertSection).toContain("'customchips'");
  });

  it("preserves next_id/next_task_number from the board's own counters rather than resetting them", () => {
    const upsertSection = sql.slice(sql.indexOf("insert into schedule_projects"), sql.indexOf("insert into schedule_calendars"));
    expect(upsertSection).toContain("coalesce((fsp.board ->> 'nextid')::int, 1)");
    expect(upsertSection).toContain("coalesce((fsp.board ->> 'nexttasknumber')::int, 1010)");
  });

  it("reuses the exact per-table transformation from the original backfill (namespacing, week-to-day conversion)", () => {
    expect(sql).toContain("fsp.id || '_' ||");
    expect(sql).toContain("(fsp.board ->> 'startdate')::date + (((block ->> 'startidx')::int) * 7)");
    expect(sql).toContain("((block ->> 'duration')::int) * 7");
  });

  it("runs a one-time catch-up over every existing project after the function is created", () => {
    const catchUpSection = sql.slice(sql.indexOf("do $$"));
    expect(catchUpSection).toContain("for project_row in select owner_id, id from forge_scheduling_projects loop");
    expect(catchUpSection).toContain("perform sync_schedule_project_from_board(project_row.owner_id, project_row.id)");
  });

  it("never deletes or truncates forge_scheduling_projects -- it stays the write target this phase", () => {
    expect(sql).not.toContain("delete from forge_scheduling_projects");
    expect(sql).not.toContain("truncate");
    expect(sql).not.toContain("drop table");
  });
});
