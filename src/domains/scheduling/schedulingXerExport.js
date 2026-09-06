// Pure, framework-agnostic Primavera P6 .xer export -- SCHED-12, the "Export Plan" from the
// original scheduling design doc (section 6), deferred until schema/CPM/UI were all real (they
// now are). Not wired into any route or UI yet -- that's SCHED-13, same two-slice pattern as every
// prior capability area in this build-out.
//
// GROUND TRUTH: the file structure, CALENDAR.clndr_data grammar, and the PROJECT/PROJWBS/CALENDAR/
// TASK/TASKPRED field lists below were verified against a real P6-exported .xer file (a public
// sample project, P6 version 18.8), not reconstructed from memory or secondhand documentation --
// see this module's test file for the literal strings pulled from that sample. RSRC/TASKRSRC and
// the cstr_type constraint-code mapping were NOT present in that sample project (it had no
// resources or constraints) and are sourced from well-established, widely-documented P6 codes
// instead -- flagged here as the one part of this module without a verified real-file citation.
//
// XER is self-describing per table: each %T section's own %F line defines the column order for
// the %R rows that follow it, so this exporter is free to choose a minimal-but-complete field
// subset per table rather than needing bit-for-bit parity with everything a real P6 export
// contains (which also carries dozens of UI-cosmetic/versioning fields this schema has no
// equivalent for).

const RELATIONSHIP_TYPE_TO_XER = Object.freeze({ FS: "PR_FS", SS: "PR_SS", FF: "PR_FF", SF: "PR_SF" });

// P6's constraint model has no separate "soft vs. hard" pair the way this schema does (start_on
// vs. must_start_on) -- both map to the same P6 code; P6's own scheduling options determine how
// forcefully a given constraint type behaves. That's a real, named loss of fidelity in this
// export, not an oversight.
const CONSTRAINT_TYPE_TO_XER = Object.freeze({
  ALAP: "CS_ALAP",
  start_on: "CS_MSO", must_start_on: "CS_MSO",
  finish_on: "CS_MEO", must_finish_on: "CS_MEO",
  SNET: "CS_MSOA", SNLT: "CS_MSOB",
  FNET: "CS_MEOA", FNLT: "CS_MEOB",
});

const RESOURCE_TYPE_TO_XER = Object.freeze({ labor: "RT_Labor", nonlabor: "RT_Equip", material: "RT_Mat" });

const HOURS_PER_DAY = 8; // assumed uniform 8-hour workday for every working day this exporter writes -- see buildClndrData.

function xerRow(fields) {
  return `%R\t${fields.map((value) => (value == null ? "" : String(value))).join("\t")}\r\n`;
}
function xerTable(name, fieldNames, rows) {
  return `%T\t${name}\r\n%F\t${fieldNames.join("\t")}\r\n${rows.map(xerRow).join("")}`;
}

// P6 stamps dates as "YYYY-MM-DD HH:MM". This schema's dates are date-only (no time-of-day
// concept), so every date gets a fixed "00:00" appended rather than inventing a per-calendar
// shift-alignment time this data was never meant to carry.
function xerDateTime(dateISO) {
  return dateISO == null ? "" : `${dateISO} 00:00`;
}

// Excel/Lotus serial date (days since 1899-12-30) -- confirmed as the CALENDAR.clndr_data
// Exceptions encoding via a real XER sample's parser (5+ digit numbers relative to that epoch).
function excelSerialDate(dateISO) {
  const epoch = Date.UTC(1899, 11, 30);
  const target = Date.UTC(...dateISO.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
  return Math.round((target - epoch) / 86_400_000);
}

// Verified grammar (from a real sample, see the test file): an outer
// (0||CalendarData()( (0||DaysOfWeek()( <day1>...<day7> )) (0||Exceptions()( <exception>* )) ))
// wrapper. Day numbering is 1=Sunday..7=Saturday (confirmed: a 5-day-week sample calendar had
// empty blocks for days 1 and 7); this schema's working_days is 0=Sun..6=Sat, so p6Day = ourDay+1.
// Every working day gets exactly one all-day shift (HOURS_PER_DAY, starting 08:00) -- P6 supports
// multiple shifts per day (e.g. a lunch-break split, seen in the same sample), but this schema has
// no shift-splitting concept to translate, so one shift per working day is the honest mapping.
export function buildClndrData(workingDays, holidayDatesISO = []) {
  const workingSet = new Set(workingDays);
  const shiftEndHour = String(8 + HOURS_PER_DAY).padStart(2, "0");
  const days = [];
  for (let p6Day = 1; p6Day <= 7; p6Day += 1) {
    const isWorking = workingSet.has(p6Day - 1); // p6Day 1..7 (Sun..Sat) maps directly to our 0..6 (Sun..Sat).
    days.push(isWorking
      ? `(0||${p6Day}()((0||0(s|08:00|f|${shiftEndHour}:00)())))`
      : `(0||${p6Day}()())`);
  }
  const exceptions = holidayDatesISO.map((dateISO, index) => `(0||${index}(d|${excelSerialDate(dateISO)})())`).join("");
  return `(0||CalendarData()((0||DaysOfWeek()(${days.join("")}))(0||Exceptions()(${exceptions}))))`;
}

// One shared counter across every entity in the export -- P6's *_id columns only need to be
// unique WITHIN their own table in a real database, but a single global sequence is still valid
// input and far simpler than maintaining a separate counter per table.
function createIdAllocator() {
  let next = 1;
  const idsByKey = new Map();
  return (key) => {
    if (key == null) return "";
    if (!idsByKey.has(key)) idsByKey.set(key, next++);
    return idsByKey.get(key);
  };
}

export function exportProjectToXer({
  project, calendars = [], holidays = [], wbsNodes = [], lanes = [], blocks = [], dependencies = [],
  resources = [], assignments = [], exportedBy = "forge", exportedAtISO,
}) {
  const xid = createIdAllocator();
  const projId = xid(project.id);
  const obsId = xid("__obs__");
  const rootWbsId = xid(`__root_wbs__${project.id}`);

  const holidaysByCalendarId = new Map();
  for (const holiday of holidays) {
    if (!holidaysByCalendarId.has(holiday.calendar_id)) holidaysByCalendarId.set(holiday.calendar_id, []);
    holidaysByCalendarId.get(holiday.calendar_id).push(holiday.holiday_date);
  }

  // A project with no calendars at all still needs a clndr_id for PROJECT/TASK to reference --
  // synthesize one standard 5-day calendar rather than emitting an invalid blank reference.
  const effectiveCalendars = calendars.length > 0 ? calendars : [{ id: "__default_calendar__", name: "Standard 5 Day Workweek", working_days: [1, 2, 3, 4, 5], schedule_project_id: null }];
  const defaultCalendarId = project.default_calendar_id && calendars.some((calendar) => calendar.id === project.default_calendar_id)
    ? project.default_calendar_id
    : effectiveCalendars[0].id;

  const currtype = xerTable(
    "CURRTYPE",
    ["curr_id", "decimal_digit_cnt", "curr_symbol", "decimal_symbol", "digit_group_symbol", "pos_curr_fmt_type", "neg_curr_fmt_type", "curr_type", "curr_short_name", "group_digit_cnt", "base_exch_rate"],
    [[1, 2, "$", ".", ",", "#1.1", "(#1.1)", "US Dollar", "USD", 3, 1]],
  );

  const obs = xerTable("OBS", ["obs_id", "parent_obs_id", "guid", "seq_num", "obs_name", "obs_descr"], [[obsId, "", "", 0, "Enterprise", ""]]);

  const calendarRows = effectiveCalendars.map((calendar) => [
    xid(calendar.id), calendar.id === defaultCalendarId ? "Y" : "N", calendar.name,
    calendar.schedule_project_id ? projId : "", "",
    calendar.schedule_project_id ? "CA_Project" : "CA_Base",
    HOURS_PER_DAY, calendar.working_days.length * HOURS_PER_DAY, 172, 2000,
    buildClndrData(calendar.working_days, holidaysByCalendarId.get(calendar.id) ?? []),
  ]);
  const calendarTable = xerTable("CALENDAR", ["clndr_id", "default_flag", "clndr_name", "proj_id", "base_clndr_id", "clndr_type", "day_hr_cnt", "week_hr_cnt", "month_hr_cnt", "year_hr_cnt", "clndr_data"], calendarRows);

  const projectRow = [
    projId, 1, "Y", "Y", "Y", "N", "Y", "N", "N", "Y", ".", "CP_Phys", (project.name || "").slice(0, 40),
    xid(defaultCalendarId), "1000", "10", 500, xerDateTime(project.start_date), xerDateTime(project.end_date),
    "DT_FixedDrtn", "QT_Hour", "TT_Task", "COST_PER_QTY", "N", "Y", "Y", "CT_TotFloat", 0,
  ];
  const projectTable = xerTable(
    "PROJECT",
    ["proj_id", "fy_start_month_num", "rsrc_self_add_flag", "allow_complete_flag", "rsrc_multi_assign_flag", "checkout_flag", "project_flag", "step_complete_flag", "cost_qty_recalc_flag", "batch_sum_flag", "name_sep_char", "def_complete_pct_type", "proj_short_name", "clndr_id", "task_code_base", "task_code_step", "priority_num", "plan_start_date", "plan_end_date", "def_duration_type", "def_qty_type", "def_task_type", "def_rate_type", "add_act_remain_flag", "act_this_per_link_flag", "act_pct_link_flag", "critical_path_type", "critical_drtn_hr_cnt"],
    [projectRow],
  );

  const wbsRows = [[rootWbsId, projId, obsId, 0, "Y", "WS_Open", (project.name || "").slice(0, 20), project.name, ""]];
  for (const lane of lanes) {
    wbsRows.push([xid(lane.id), projId, obsId, lane.sort_order ?? 0, "N", "WS_Open", (lane.name || "").slice(0, 20), lane.name, rootWbsId]);
  }
  for (const node of wbsNodes) {
    wbsRows.push([xid(node.id), projId, obsId, node.sort_order ?? 0, "N", "WS_Open", node.code, node.name, node.parent_id ? xid(node.parent_id) : rootWbsId]);
  }
  const wbsTable = xerTable("PROJWBS", ["wbs_id", "proj_id", "obs_id", "seq_num", "proj_node_flag", "status_code", "wbs_short_name", "wbs_name", "parent_wbs_id"], wbsRows);

  function taskStatusCode(block) {
    if (block.actual_finish || block.percent_complete >= 100) return "TK_Complete";
    if (block.actual_start || block.percent_complete > 0) return "TK_Active";
    return "TK_NotStart";
  }
  function taskType(block) {
    if (block.block_type === "milestone") return "TT_Mile"; // no start/finish-milestone distinction in this schema -- always treated as a start milestone.
    if (block.block_type === "hammock") return "TT_LOE"; // Level of Effort is P6's closest concept to a derived-span summary bar.
    return "TT_Task";
  }

  const taskRows = blocks.map((block) => {
    const durationHours = (block.duration_days ?? 0) * HOURS_PER_DAY;
    const remainingHours = Math.round(durationHours * (1 - (block.percent_complete ?? 0) / 100));
    const constraintCode = block.constraint_type ? CONSTRAINT_TYPE_TO_XER[block.constraint_type] ?? "" : "";
    return [
      xid(block.id), projId,
      block.wbs_node_id ? xid(block.wbs_node_id) : (block.lane_id ? xid(block.lane_id) : rootWbsId),
      xid(block.calendar_id || defaultCalendarId),
      block.percent_complete ?? 0, "CP_Phys", taskType(block), "DT_FixedDrtn", taskStatusCode(block),
      block.task_code, block.label, durationHours, remainingHours,
      xerDateTime(block.constraint_date), constraintCode, "", "",
      xerDateTime(block.early_start), xerDateTime(block.early_finish),
      xerDateTime(block.late_start), xerDateTime(block.late_finish),
      xerDateTime(block.early_start), xerDateTime(block.early_finish),
      xerDateTime(block.actual_start), xerDateTime(block.actual_finish),
      block.is_critical ? "Y" : "N", "PT_Normal",
    ];
  });
  const taskTable = xerTable(
    "TASK",
    ["task_id", "proj_id", "wbs_id", "clndr_id", "phys_complete_pct", "complete_pct_type", "task_type", "duration_type", "status_code", "task_code", "task_name", "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "cstr_date", "cstr_type", "cstr_date2", "cstr_type2", "early_start_date", "early_end_date", "late_start_date", "late_end_date", "target_start_date", "target_end_date", "act_start_date", "act_end_date", "driving_path_flag", "priority_type"],
    taskRows,
  );

  // Lag is applied in CALENDAR days by this schema's own CPM engine (real elapsed time, e.g.
  // concrete curing over a weekend -- see schedulingCpmEngine.js), so it's translated to hours as
  // 24h/calendar-day here, not 8h/working-day -- the latter would silently change its meaning.
  const taskpredRows = dependencies.map((dependency) => [
    xid(dependency.id), xid(dependency.successor_id), xid(dependency.predecessor_id), projId, projId,
    RELATIONSHIP_TYPE_TO_XER[dependency.relationship_type] ?? "PR_FS", (dependency.lag_days ?? 0) * 24,
  ]);
  const taskpredTable = xerTable("TASKPRED", ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"], taskpredRows);

  let resourceSections = "";
  if (resources.length > 0) {
    const rsrcRows = resources.map((resource) => [
      xid(resource.id), resource.name, (resource.name || "").slice(0, 20),
      RESOURCE_TYPE_TO_XER[resource.resource_type] ?? "RT_Labor",
      (resource.max_units_per_day ?? HOURS_PER_DAY) / HOURS_PER_DAY,
      xid(resource.calendar_id || defaultCalendarId),
    ]);
    resourceSections += xerTable("RSRC", ["rsrc_id", "rsrc_name", "rsrc_short_name", "rsrc_type", "def_qty_per_hr", "clndr_id"], rsrcRows);

    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const taskrsrcRows = assignments.map((assignment) => {
      const resource = resourcesById.get(assignment.resource_id);
      const rate = assignment.rate_override ?? resource?.std_rate ?? 0;
      const targetQty = assignment.budgeted_units ?? 0;
      const actualQty = assignment.actual_units ?? 0;
      return [
        xid(assignment.id ?? `${assignment.block_id}:${assignment.resource_id}`), xid(assignment.block_id), projId, xid(assignment.resource_id),
        targetQty, actualQty, targetQty - actualQty, targetQty * rate, actualQty * rate, (targetQty - actualQty) * rate, rate,
      ];
    });
    resourceSections += xerTable("TASKRSRC", ["taskrsrc_id", "task_id", "proj_id", "rsrc_id", "target_qty", "act_reg_qty", "remain_qty", "target_cost", "act_reg_cost", "remain_cost", "cost_per_qty"], taskrsrcRows);
  }

  const exportDate = (exportedAtISO || new Date().toISOString()).slice(0, 10);
  const header = `ERMHDR\t17.7\t${exportDate}\tProject\t${exportedBy}\t${exportedBy}\tforge409\t${(project.name || "").slice(0, 40)}\tUSD\r\n`;

  return `${header}${currtype}${obs}${projectTable}${calendarTable}${wbsTable}${taskTable}${taskpredTable}${resourceSections}%E\r\n`;
}
