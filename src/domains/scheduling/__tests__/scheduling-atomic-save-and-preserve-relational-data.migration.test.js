import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260907010000_add_schedule_atomic_save_and_preserve_relational_data.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

function functionBody(name) {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("schedule atomic save and preserve relational data migration", () => {
  it("adds board_revision to schedule_projects without dropping/recreating the table", () => {
    expect(sql).toContain("alter table schedule_projects");
    expect(sql).toContain("add column if not exists board_revision bigint not null default 0");
    expect(sql).not.toContain("drop table");
  });

  it("never issues a project-wide delete-everything on schedule_blocks -- every delete is scoped to ids missing from the submitted board", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const blockDeletes = [...body.matchAll(/delete from schedule_blocks\b[^;]*;/g)];
    expect(blockDeletes.length).toBeGreaterThan(0);
    for (const [statement] of blockDeletes) {
      expect(statement).toContain("and id not in (");
    }
  });

  it("upserts every relational table by stable id instead of delete-then-reinsert", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const upsertTargets = [
      "schedule_projects", "schedule_calendars", "schedule_wbs_nodes",
      "schedule_blackout_windows", "schedule_lanes", "schedule_blocks", "schedule_dependencies",
    ];
    for (const table of upsertTargets) {
      expect(body).toContain(`insert into ${table}`);
      const insertIndex = body.indexOf(`insert into ${table}`);
      const nextOnConflict = body.indexOf("on conflict (owner_id, id) do update set", insertIndex);
      expect(nextOnConflict).toBeGreaterThan(insertIndex);
    }
    expect(body).not.toContain("do nothing");
  });

  it("excludes progress/actual-dates/constraint/CPM columns from the Gantt-block UPDATE clause, so an existing activity keeps whatever those other routes already set", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const ganttUpsert = body.slice(body.indexOf("-- 8a."), body.indexOf("-- 8b."));
    const updateClause = ganttUpsert.slice(ganttUpsert.indexOf("on conflict (owner_id, id) do update set"));
    for (const relationalOnlyColumn of [
      "percent_complete =", "actual_start =", "actual_finish =", "constraint_type =", "constraint_date =",
      "calendar_id =", "early_start =", "early_finish =", "late_start =", "late_finish =",
      "total_float_days =", "is_critical =",
    ]) {
      expect(updateClause).not.toContain(relationalOnlyColumn);
    }
  });

  it("still sources WBS-activity percentComplete from the board on both insert and update, unchanged from today", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const wbsUpsert = body.slice(body.indexOf("-- 8b."), body.indexOf("-- 9."));
    expect(wbsUpsert).toContain("percent_complete");
    expect(wbsUpsert).toContain("percent_complete = excluded.percent_complete");
  });

  it("never deletes or reinserts schedule_calendar_holidays -- holidays are not part of the board JSON and must survive every save", () => {
    const body = functionBody("sync_schedule_project_from_board");
    expect(body).not.toContain("schedule_calendar_holidays");
  });

  it("explicitly clears assignments/expenses for a genuinely-pruned block before deleting it, not relying solely on cascade", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const assignmentsDeleteIndex = body.indexOf("delete from schedule_resource_assignments");
    const expensesDeleteIndex = body.indexOf("delete from schedule_expenses");
    const blocksDeleteIndex = body.indexOf("delete from schedule_blocks");
    expect(assignmentsDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(expensesDeleteIndex).toBeGreaterThan(assignmentsDeleteIndex);
    expect(blocksDeleteIndex).toBeGreaterThan(expensesDeleteIndex);
  });

  it("clears dependents before parents: dependencies/hammock anchors before blocks, blocks before lanes/wbs_nodes/calendars", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const dependenciesDeleteIndex = body.indexOf("delete from schedule_dependencies");
    const hammockDeleteIndex = body.indexOf("delete from schedule_hammock_anchors");
    const blocksDeleteIndex = body.indexOf("delete from schedule_blocks");
    const lanesDeleteIndex = body.indexOf("delete from schedule_lanes");
    const calendarsDeleteIndex = body.indexOf("delete from schedule_calendars");
    expect(hammockDeleteIndex).toBeGreaterThan(dependenciesDeleteIndex);
    expect(blocksDeleteIndex).toBeGreaterThan(hammockDeleteIndex);
    expect(lanesDeleteIndex).toBeGreaterThan(blocksDeleteIndex);
    expect(calendarsDeleteIndex).toBeGreaterThan(lanesDeleteIndex);
  });

  it("enforces the ownership boundary in both functions, since security definer bypasses RLS", () => {
    for (const name of ["sync_schedule_project_from_board", "save_schedule_project_board"]) {
      const body = functionBody(name);
      expect(body).toContain("security definer");
      expect(body).toContain("auth.uid() is not null and p_owner_id <> auth.uid()::text");
    }
  });

  it("revokes public execute and grants only to authenticated for both functions", () => {
    for (const signature of ["sync_schedule_project_from_board(text, text)", "save_schedule_project_board(text, text, jsonb, bigint)"]) {
      expect(sql).toContain(`revoke all on function ${signature} from public`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    }
  });

  it("save_schedule_project_board locks the project row with for update before comparing revisions, closing the check-then-update race", () => {
    const body = functionBody("save_schedule_project_board");
    const selectIndex = body.indexOf("select sp.board_revision into v_current_revision");
    const forUpdateIndex = body.indexOf("for update", selectIndex);
    const conflictCheckIndex = body.indexOf("v_current_revision <> p_expected_revision", selectIndex);
    expect(forUpdateIndex).toBeGreaterThan(selectIndex);
    expect(conflictCheckIndex).toBeGreaterThan(forUpdateIndex);
  });

  it("raises a distinctive conflict error a route can translate to 409, and a distinctive not-found error for anything else", () => {
    const body = functionBody("save_schedule_project_board");
    expect(body).toContain("raise exception 'schedule_save_conflict'");
    expect(body).toContain("raise exception 'schedule_save_not_found'");
  });

  it("writes the board JSON and calls the relational sync inside the same function call, so a sync failure rolls back the JSON write too", () => {
    const body = functionBody("save_schedule_project_board");
    const jsonWriteIndex = body.indexOf("update forge_scheduling_projects");
    const syncCallIndex = body.indexOf("perform sync_schedule_project_from_board(p_owner_id, p_project_id)");
    const revisionBumpIndex = body.indexOf("board_revision = coalesce(board_revision, 0) + 1");
    expect(jsonWriteIndex).toBeGreaterThanOrEqual(0);
    expect(syncCallIndex).toBeGreaterThan(jsonWriteIndex);
    expect(revisionBumpIndex).toBeGreaterThan(syncCallIndex);
  });

  it("never touches forge_scheduling_projects or schedule_projects rows outside a single (owner_id, id) pair -- no project-wide or table-wide statement", () => {
    expect(sql).not.toContain("delete from forge_scheduling_projects");
    expect(sql).not.toContain("truncate");
    expect(sql).not.toContain("drop table");
    // The one-time backfill loop from the prior migration ("do $$ ... for project_row in select ...
    // loop") is deliberately absent here -- this migration must not run any cleanup/backfill against
    // existing data, per SCHED-20's explicit requirement.
    expect(sql).not.toContain("for project_row in select");
  });
});
