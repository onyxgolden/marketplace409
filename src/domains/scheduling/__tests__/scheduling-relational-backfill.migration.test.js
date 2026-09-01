import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260827000100_backfill_scheduling_projects_from_board_jsonb.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("scheduling relational backfill migration", () => {
  it("sources every insert from forge_scheduling_projects -- backfills whatever exists, not a hardcoded row count", () => {
    expect(sql).toContain("from forge_scheduling_projects fsp");
    expect(sql).not.toMatch(/where\s+fsp\.id\s*=/);
  });

  it("is idempotent: every insert guards against re-running with on conflict do nothing", () => {
    const insertCount = (sql.match(/insert into/g) || []).length;
    const conflictGuardCount = (sql.match(/on conflict .*? do nothing/g) || []).length;
    expect(insertCount).toBeGreaterThan(0);
    expect(conflictGuardCount).toBe(insertCount);
  });

  it("namespaces every board-internal id by schedule_project_id to avoid collisions across an owner's multiple projects", () => {
    // fsp.id || '_' || (...) is the namespacing expression, applied on every id and id-reference
    // sourced from inside a board blob.
    const namespacingOccurrences = (sql.match(/fsp\.id \|\| '_' \|\|/g) || []).length;
    // projects, calendars, wbs_nodes (+parent_id), blackout_windows, lanes (+calendar_id),
    // gantt blocks (+lane_id), wbs activities (+wbs_node_id), dependencies (predecessor+successor)
    expect(namespacingOccurrences).toBeGreaterThanOrEqual(10);
  });

  it("resolves the schedule_projects <-> schedule_calendars circular reference: projects inserted first without default_calendar_id, then updated once calendars exist", () => {
    const projectsInsertIndex = sql.indexOf("insert into schedule_projects");
    const calendarsInsertIndex = sql.indexOf("insert into schedule_calendars");
    const updateIndex = sql.indexOf("update schedule_projects");
    expect(projectsInsertIndex).toBeGreaterThanOrEqual(0);
    expect(calendarsInsertIndex).toBeGreaterThan(projectsInsertIndex);
    expect(updateIndex).toBeGreaterThan(calendarsInsertIndex);
    expect(sql.slice(updateIndex, updateIndex + 400)).toContain("default_calendar_id");
  });

  it("converts week-index/week-duration Gantt blocks to day-granular dates using board.startDate + startIdx * 7 -- not an approximation", () => {
    expect(sql).toContain("(fsp.board ->> 'startdate')::date + (((block ->> 'startidx')::int) * 7)");
    expect(sql).toContain("((block ->> 'duration')::int) * 7");
  });

  it("unifies Gantt blocks and WBS activities into schedule_blocks (Decision 1): Gantt blocks get lane_id, WBS activities get wbs_node_id, never both", () => {
    const ganttBlockInsert = sql.slice(sql.indexOf("-- 7. blocks"), sql.indexOf("-- 8. dependencies"));
    const ganttSection = ganttBlockInsert.slice(0, ganttBlockInsert.indexOf("insert into schedule_blocks", ganttBlockInsert.indexOf("insert into schedule_blocks") + 1));
    expect(ganttSection).toContain("fsp.id || '_' || (block ->> 'laneid')");
    expect(ganttSection).toMatch(/null,\s*\n?\s*block ->> 'label'/);
    expect(ganttBlockInsert).toContain("fsp.id || '_' || (activity ->> 'wbsid')");
    expect(ganttBlockInsert).toContain("'wbs',");
  });

  it("leaves WBS-activity rows with no placement data (start_date null) -- they never had any in the live shape", () => {
    const blocksInsertPositions = [];
    let searchFrom = 0;
    while (true) {
      const found = sql.indexOf("insert into schedule_blocks", searchFrom);
      if (found === -1) break;
      blocksInsertPositions.push(found);
      searchFrom = found + 1;
    }
    expect(blocksInsertPositions).toHaveLength(2);
    const activityInsertStart = blocksInsertPositions[1];
    const activityInsertEnd = sql.indexOf("insert into schedule_dependencies");
    const activitySection = sql.slice(activityInsertStart, activityInsertEnd);
    expect(activitySection).toContain("'wbs' -> 'activities'");
    expect(activitySection).toContain("null,");
  });

  it("guards every jsonb_array_elements call against a missing/absent field with coalesce(..., '[]'::jsonb)", () => {
    const arrayElementCalls = (sql.match(/jsonb_array_elements\(coalesce\(/g) || []).length;
    expect(arrayElementCalls).toBeGreaterThanOrEqual(7);
  });

  it("never deletes or truncates forge_scheduling_projects -- the JSONB blob stays the source of truth this phase", () => {
    expect(sql).not.toContain("delete from forge_scheduling_projects");
    expect(sql).not.toContain("truncate");
    expect(sql).not.toContain("drop table");
  });
});
