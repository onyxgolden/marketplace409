import { describe, expect, it } from "vitest";
import { buildClndrData, exportProjectToXer } from "./schedulingXerExport";

// The literal substrings asserted below ("(0||1()((0||0(s|08:00|f|16:00)())))" and "(0||1()())")
// are copied verbatim from a real P6-exported .xer file's CALENDAR.clndr_data field (P6 version
// 18.8, a public sample project) -- not reconstructed from memory. See schedulingXerExport.js's
// header comment for the full research trail.

describe("schedulingXerExport — buildClndrData", () => {
  it("encodes a 7-day working calendar using the exact day-block grammar confirmed from a real P6 export", () => {
    const data = buildClndrData([0, 1, 2, 3, 4, 5, 6]);
    expect(data).toContain("(0||CalendarData()((0||DaysOfWeek()(");
    // Every one of the 7 days should use this exact single-shift block, confirmed verbatim
    // against a real sample's "7-Day Workweek" calendar.
    for (let p6Day = 1; p6Day <= 7; p6Day += 1) {
      expect(data).toContain(`(0||${p6Day}()((0||0(s|08:00|f|16:00)())))`);
    }
    expect(data).toContain("(0||Exceptions()()))");
  });

  it("encodes Sunday and Saturday as non-working for a Mon-Fri calendar, using the confirmed empty-day grammar", () => {
    const data = buildClndrData([1, 2, 3, 4, 5]);
    expect(data).toContain("(0||1()())"); // Sunday (p6Day 1) -- confirmed non-working grammar from the real sample.
    expect(data).toContain("(0||7()())"); // Saturday (p6Day 7).
    expect(data).toContain("(0||2()((0||0(s|08:00|f|16:00)())))"); // Monday -- working.
  });

  it("encodes a holiday as an Excel-serial-date exception", () => {
    const data = buildClndrData([1, 2, 3, 4, 5], ["2021-01-01"]);
    expect(data).toContain("(0||Exceptions()((0||0(d|44197)())))"); // 2021-01-01 is Excel serial 44197 -- a well-established constant, independent verification of excelSerialDate's epoch math.
  });

  it("emits no exceptions block content for a calendar with no holidays", () => {
    const data = buildClndrData([1, 2, 3, 4, 5], []);
    expect(data).toContain("(0||Exceptions()()))");
  });
});

function baseProject(overrides = {}) {
  return { id: "proj_1", name: "Test Project", start_date: "2026-01-05", end_date: "2026-06-30", default_calendar_id: "cal_1", ...overrides };
}
function baseCalendar(overrides = {}) {
  return { id: "cal_1", name: "5-Day Workweek", working_days: [1, 2, 3, 4, 5], schedule_project_id: null, ...overrides };
}
function baseBlock(id, overrides = {}) {
  return {
    id, task_code: id, label: `Task ${id}`, block_type: "task", lane_id: "lane_1", wbs_node_id: null,
    duration_days: 5, percent_complete: 0, calendar_id: null, constraint_type: null, constraint_date: null,
    early_start: "2026-01-05", early_finish: "2026-01-09", late_start: "2026-01-05", late_finish: "2026-01-09",
    actual_start: null, actual_finish: null, is_critical: true, ...overrides,
  };
}

describe("schedulingXerExport — exportProjectToXer", () => {
  it("produces a well-formed file: ERMHDR header, required tables, and a trailing %E", () => {
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")], lanes: [{ id: "lane_1", name: "Field", sort_order: 0 }] });
    expect(xer.startsWith("ERMHDR\t17.7\t")).toBe(true);
    expect(xer).toContain("%T\tPROJECT\r\n");
    expect(xer).toContain("%T\tCALENDAR\r\n");
    expect(xer).toContain("%T\tPROJWBS\r\n");
    expect(xer).toContain("%T\tTASK\r\n");
    expect(xer).toContain("%T\tTASKPRED\r\n");
    expect(xer.endsWith("%E\r\n")).toBe(true);
  });

  it("carries the task_code and task_name through onto the TASK row", () => {
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A1010", { label: "Site Mobilization" })], lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).toContain("A1010\tSite Mobilization");
  });

  it("maps FS/SS/FF/SF relationship types to the correct PR_ codes in TASKPRED", () => {
    const blocks = [baseBlock("A"), baseBlock("B")];
    const dependencies = [{ id: "dep_1", predecessor_id: "A", successor_id: "B", relationship_type: "SS", lag_days: 2 }];
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks, dependencies, lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).toContain("PR_SS");
    expect(xer).toContain("\t48\r\n"); // 2 calendar days of lag -> 48 hours (24h/calendar-day, not 8h/working-day -- see the module comment).
  });

  it("assigns the same integer id to a block wherever it's referenced, across TASK and TASKPRED", () => {
    const blocks = [baseBlock("A"), baseBlock("B")];
    const dependencies = [{ id: "dep_1", predecessor_id: "A", successor_id: "B", relationship_type: "FS", lag_days: 0 }];
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks, dependencies, lanes: [{ id: "lane_1", name: "Field" }] });
    const taskLines = xer.split("\r\n").filter((line) => line.startsWith("%R") && line.includes("Task A"));
    const [, taskIdA] = taskLines[0].split("\t");
    const taskpredLine = xer.split("\r\n").find((line) => line.startsWith("%R") && line.includes("PR_FS"));
    expect(taskpredLine).toContain(`\t${taskIdA}\t`); // pred_task_id in TASKPRED should equal A's own task_id.
  });

  it("maps block_type to TT_Mile for a milestone and TT_LOE for a hammock", () => {
    const blocks = [baseBlock("M", { block_type: "milestone", duration_days: 0 }), baseBlock("H", { block_type: "hammock" })];
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks, lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).toContain("TT_Mile");
    expect(xer).toContain("TT_LOE");
  });

  it("maps a hard must_start_on constraint to the CS_MSO code", () => {
    const blocks = [baseBlock("A", { constraint_type: "must_start_on", constraint_date: "2026-01-05" })];
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks, lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).toContain("CS_MSO");
  });

  it("synthesizes a default 5-day calendar when the project has none", () => {
    const xer = exportProjectToXer({ project: baseProject({ default_calendar_id: null }), calendars: [], blocks: [baseBlock("A")], lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).toContain("Standard 5 Day Workweek");
  });

  it("omits RSRC/TASKRSRC entirely when there are no resources", () => {
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")], lanes: [{ id: "lane_1", name: "Field" }] });
    expect(xer).not.toContain("%T\tRSRC");
    expect(xer).not.toContain("%T\tTASKRSRC");
  });

  it("includes RSRC/TASKRSRC with cost figures derived from budgeted units and rate", () => {
    const resources = [{ id: "res_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50, calendar_id: null }];
    const assignments = [{ id: "assign_1", block_id: "A", resource_id: "res_1", budgeted_units: 40, actual_units: 10, rate_override: null }];
    const xer = exportProjectToXer({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")], lanes: [{ id: "lane_1", name: "Field" }], resources, assignments });
    expect(xer).toContain("%T\tRSRC\r\n");
    expect(xer).toContain("RT_Labor");
    expect(xer).toContain("%T\tTASKRSRC\r\n");
    expect(xer).toContain("\t40\t10\t30\t2000\t500\t1500\t50\r\n"); // target/actual/remain qty, target/actual/remain cost, rate.
  });
});
