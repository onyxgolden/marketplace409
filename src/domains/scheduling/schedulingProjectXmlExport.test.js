import { describe, expect, it } from "vitest";
import { exportProjectToProjectXml } from "./schedulingProjectXmlExport";

// Every element name/order/enum value asserted below is confirmed against Microsoft's own
// published mspdi_pj12.xsd schema-reference pages (Microsoft Learn), fetched during this
// session's research -- not reconstructed from memory. See schedulingProjectXmlExport.js's
// header comment for the full citation trail.

function baseProject(overrides = {}) {
  return { id: "proj_1", name: "Test Project", start_date: "2026-01-05", end_date: "2026-06-30", default_calendar_id: "cal_1", ...overrides };
}
function baseCalendar(overrides = {}) {
  return { id: "cal_1", name: "5-Day Workweek", working_days: [1, 2, 3, 4, 5], schedule_project_id: null, ...overrides };
}
function baseBlock(id, overrides = {}) {
  return {
    id, task_code: id, label: `Task ${id}`, block_type: "task",
    duration_days: 5, percent_complete: 0, calendar_id: null, constraint_type: null, constraint_date: null,
    early_start: "2026-01-05", early_finish: "2026-01-09", late_start: "2026-01-05", late_finish: "2026-01-09",
    actual_start: null, actual_finish: null, is_critical: true, ...overrides,
  };
}

describe("schedulingProjectXmlExport — exportProjectToProjectXml", () => {
  it("produces a well-formed document: XML declaration, namespaced root, and elements in schema-confirmed order", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")] });
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true);
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project/2007">');
    // Calendars must appear before Tasks, which must appear before Resources/Assignments --
    // confirmed schema order (an xsd:sequence, unlike XER's order-independent tables).
    expect(xml.indexOf("<Calendars>")).toBeLessThan(xml.indexOf("<Tasks>"));
    expect(xml.endsWith("</Project>")).toBe(true);
  });

  it("carries the task label and WBS (task_code) through onto the Task element", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A1010", { label: "Site Mobilization" })] });
    expect(xml).toContain("<Name>Site Mobilization</Name>");
    expect(xml).toContain("<WBS>A1010</WBS>");
  });

  it("encodes duration as an ISO 8601 PT..H0M0S value from duration_days * 8 hours", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A", { duration_days: 5 })] });
    expect(xml).toContain("<Duration>PT40H0M0S</Duration>");
  });

  it("marks a milestone block with Milestone=1 and a task with Milestone=0", () => {
    const blocks = [baseBlock("M", { block_type: "milestone", duration_days: 0 }), baseBlock("T")];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks });
    expect(xml).toContain("<Milestone>1</Milestone>");
    expect(xml).toContain("<Milestone>0</Milestone>");
  });

  it("nests a PredecessorLink inside the successor Task, using the confirmed 0=FF/1=FS/2=SF/3=SS numbering", () => {
    const blocks = [baseBlock("A"), baseBlock("B")];
    const dependencies = [{ id: "dep_1", predecessor_id: "A", successor_id: "B", relationship_type: "SS", lag_days: 0 }];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks, dependencies });
    const taskB = xml.slice(xml.indexOf("<WBS>B</WBS>") - 200, xml.indexOf("<WBS>B</WBS>") + 500);
    expect(taskB).toContain("<PredecessorLink>");
    expect(taskB).toContain("<Type>3</Type>"); // SS = 3, per the confirmed PredecessorLink.Type table.
  });

  it("converts lag from calendar days to tenths-of-a-minute (LinkLag's documented unit)", () => {
    const blocks = [baseBlock("A"), baseBlock("B")];
    const dependencies = [{ id: "dep_1", predecessor_id: "A", successor_id: "B", relationship_type: "FS", lag_days: 1 }];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks, dependencies });
    expect(xml).toContain("<LinkLag>14400</LinkLag>"); // 1 day * 24h * 60m * 10 (tenths of a minute).
  });

  it("maps a hard must_start_on constraint to ConstraintType 2 (Must Start On)", () => {
    const blocks = [baseBlock("A", { constraint_type: "must_start_on", constraint_date: "2026-01-05" })];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks });
    expect(xml).toContain("<ConstraintType>2</ConstraintType>");
  });

  it("omits ConstraintType/ConstraintDate entirely for an unconstrained (ASAP) block", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A", { constraint_type: null })] });
    expect(xml).not.toContain("<ConstraintType>");
  });

  it("omits Resources/Assignments entirely when there are no resources", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")] });
    expect(xml).not.toContain("<Resources>");
    expect(xml).not.toContain("<Assignments>");
  });

  it("maps resource_type to the confirmed Resource.Type codes (0=Material, 1=Work)", () => {
    const resources = [
      { id: "res_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50 },
      { id: "res_2", name: "Concrete", resource_type: "material", max_units_per_day: 8, std_rate: 100 },
    ];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")], resources });
    expect(xml).toContain("<Name>Framing Crew</Name><Type>1</Type>");
    expect(xml).toContain("<Name>Concrete</Name><Type>0</Type>");
  });

  it("computes assignment Work/Cost from budgeted units and rate, always exporting Units as 1 (full allocation)", () => {
    const resources = [{ id: "res_1", name: "Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50 }];
    const assignments = [{ id: "a1", block_id: "A", resource_id: "res_1", budgeted_units: 40, actual_units: 10, rate_override: null }];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], blocks: [baseBlock("A")], resources, assignments });
    expect(xml).toContain("<Cost>2000</Cost>");
    expect(xml).toContain("<RemainingCost>1500</RemainingCost>");
    expect(xml).toContain("<Units>1</Units><Work>PT40H0M0S</Work>");
  });

  it("synthesizes a default calendar when the project has none", () => {
    const xml = exportProjectToProjectXml({ project: baseProject({ default_calendar_id: null }), calendars: [], blocks: [baseBlock("A")] });
    expect(xml).toContain("<Name>Standard</Name>");
  });

  it("marks Sunday and Saturday non-working and Monday working for a Mon-Fri calendar", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar({ working_days: [1, 2, 3, 4, 5] })], blocks: [baseBlock("A")] });
    const calendarSection = xml.slice(xml.indexOf("<Calendars>"), xml.indexOf("</Calendars>"));
    expect(calendarSection).toContain("<DayType>1</DayType><DayWorking>0</DayWorking>"); // Sunday.
    expect(calendarSection).toContain("<DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes>"); // Monday.
    expect(calendarSection).toContain("<DayType>7</DayType><DayWorking>0</DayWorking>"); // Saturday.
  });

  it("encodes a holiday as a single-day, DayWorking=0 Exception", () => {
    const holidays = [{ calendar_id: "cal_1", holiday_date: "2026-07-04" }];
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], holidays, blocks: [baseBlock("A")] });
    expect(xml).toContain("<Exceptions><Exception><TimePeriod><FromDate>2026-07-04T00:00:00</FromDate><ToDate>2026-07-04T00:00:00</ToDate></TimePeriod><DayWorking>0</DayWorking></Exception></Exceptions>");
  });

  it("omits Exceptions entirely for a calendar with no holidays", () => {
    const xml = exportProjectToProjectXml({ project: baseProject(), calendars: [baseCalendar()], holidays: [], blocks: [baseBlock("A")] });
    expect(xml).not.toContain("<Exceptions>");
  });
});
