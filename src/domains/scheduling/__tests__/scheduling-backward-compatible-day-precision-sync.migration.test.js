import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908000000_add_schedule_backward_compatible_day_precision_sync.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

function functionBody(name) {
  const start = sql.indexOf(`create or replace function ${name}`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("schedule backward-compatible day-precision sync migration (SCHED-21B1)", () => {
  it("redefines only sync_schedule_project_from_board -- save_schedule_project_board, its revision-check, and its locking are untouched by this migration", () => {
    expect(sql).toContain("create or replace function sync_schedule_project_from_board");
    expect(sql).not.toContain("create or replace function save_schedule_project_board");
    expect(sql).not.toContain("for update");
    expect(sql).not.toContain("schedule_save_conflict");
  });

  it("computes v_schema_version once, coalescing an absent schemaVersion to 1 (legacy) -- not per-block, not defaulting to 2", () => {
    const body = functionBody("sync_schedule_project_from_board");
    expect(body).toContain("v_schema_version int;");
    expect(body).toContain("v_schema_version := coalesce((v_board ->> 'schemaversion')::int, 1);");
    // Assigned exactly once, in the declare/assign preamble -- not recomputed inside the per-block
    // select (which would defeat "read once" and risk disagreeing between the Gantt-block and
    // WBS-activity upserts if a future edit ever made the two computations diverge).
    expect(body.split("v_schema_version :=").length - 1).toBe(1);
  });

  it("Gantt-block start_date: schemaVersion >= 2 reads startOffsetDays directly (no *7); legacy branch is byte-identical to the pre-SCHED-21B1 formula", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const ganttUpsert = body.slice(body.indexOf("-- 8a."), body.indexOf("-- 8b."));
    expect(ganttUpsert).toContain("when v_schema_version >= 2 then (v_board ->> 'startdate')::date + ((block ->> 'startoffsetdays')::int)");
    expect(ganttUpsert).toContain("else (v_board ->> 'startdate')::date + (((block ->> 'startidx')::int) * 7)");
  });

  it("Gantt-block duration_days: milestone still forces 0 regardless of schema version; schemaVersion >= 2 reads durationDays directly, legacy branch keeps duration*7", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const ganttUpsert = body.slice(body.indexOf("-- 8a."), body.indexOf("-- 8b."));
    expect(ganttUpsert).toContain("when (block ->> 'milestone')::boolean then 0 when v_schema_version >= 2 then (block ->> 'durationdays')::int else ((block ->> 'duration')::int) * 7 end");
    // The milestone check is evaluated before the schema-version branch, in that order, so a v2
    // milestone with no durationDays key at all still gets 0, not a null-cast surprise.
    const milestoneIndex = ganttUpsert.indexOf("when (block ->> 'milestone')::boolean then 0");
    const schemaIndex = ganttUpsert.indexOf("when v_schema_version >= 2 then (block ->> 'durationdays')::int");
    expect(milestoneIndex).toBeGreaterThanOrEqual(0);
    expect(schemaIndex).toBeGreaterThan(milestoneIndex);
  });

  it("WBS-activity duration_days branches the same way, schemaVersion >= 2 reading durationDays, legacy keeping durationWeeks*7", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const wbsUpsert = body.slice(body.indexOf("-- 8b."), body.indexOf("-- 9."));
    expect(wbsUpsert).toContain("when v_schema_version >= 2 then coalesce((activity ->> 'durationdays')::int, 0)");
    expect(wbsUpsert).toContain("else coalesce(((activity ->> 'durationweeks')::int) * 7, 0)");
  });

  it("dependency lag_days is untouched by schema version -- always the direct passthrough, in both this and the prior migration", () => {
    const body = functionBody("sync_schedule_project_from_board");
    const depsUpsert = body.slice(body.indexOf("-- 9."));
    expect(depsUpsert).toContain("coalesce((dep ->> 'lagdays')::int, 0)");
    expect(depsUpsert).not.toContain("v_schema_version");
  });

  // Everything below re-verifies the properties SCHED-20's original migration established, against
  // THIS (now the live, superseding) definition of the function -- a regression here wouldn't be
  // caught by the original migration's own test file, since that file only reads its own,
  // now-historical, migration file.
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

  it("excludes progress/actual-dates/constraint/CPM columns from the Gantt-block UPDATE clause, unaffected by the schema-version branching added here", () => {
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

  it("never deletes or reinserts schedule_calendar_holidays -- holidays are not part of the board JSON and must survive every save", () => {
    const body = functionBody("sync_schedule_project_from_board");
    expect(body).not.toContain("schedule_calendar_holidays");
  });

  it("enforces the ownership boundary, since security definer bypasses RLS", () => {
    const body = functionBody("sync_schedule_project_from_board");
    expect(body).toContain("security definer");
    expect(body).toContain("auth.uid() is not null and p_owner_id <> auth.uid()::text");
  });

  it("revokes public execute and grants only to authenticated", () => {
    expect(sql).toContain("revoke all on function sync_schedule_project_from_board(text, text) from public");
    expect(sql).toContain("grant execute on function sync_schedule_project_from_board(text, text) to authenticated");
  });

  it("issues no destructive statement against existing data -- no table-wide delete, no truncate, no drop, no backfill loop", () => {
    expect(sql).not.toContain("delete from forge_scheduling_projects");
    expect(sql).not.toContain("truncate");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("for project_row in select");
    expect(sql).not.toContain("alter table");
  });
});
