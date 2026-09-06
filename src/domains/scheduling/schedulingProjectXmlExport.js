// Pure, framework-agnostic Microsoft Project XML export -- SCHED-14, the second half of the
// original scheduling design doc's Export Plan (section 6.2), after XER (SCHED-12/13). Not wired
// into any route or UI yet -- that's SCHED-15, same two-slice pattern as every prior capability
// area in this build-out.
//
// GROUND TRUTH: unlike XER (a reverse-engineered proprietary format), this is Microsoft's own
// OFFICIALLY PUBLISHED schema (mspdi_pj12.xsd, the "Project 2007 XML Data Interchange Schema" --
// still the current interchange format; Project opens it directly via File > Open and can re-save
// as .mpp itself). Every element name, field order, and enumerated code value below was verified
// against Microsoft Learn's own schema-reference pages during this session's research (Task,
// Resource, Assignment, Calendar, ConstraintType, and the multi-parent Type element's per-parent
// enumerations) -- not reconstructed from memory. The one exception, flagged where it's used, is
// AccrueAt's exact enumeration, which wasn't independently fetched (a widely-cited, commonly used
// mapping, but without the same direct-citation confidence as everything else here).
//
// A genuinely different risk profile than XER: this schema is an xsd:sequence, meaning ELEMENT
// ORDER WITHIN EACH TYPE MATTERS (getting Task's children out of order is a validation error, not
// just cosmetic) -- unlike XER's self-describing %F/%R tables. Every element list below follows
// the confirmed schema order; optional (minOccurs="0") fields this schema has no data for are
// omitted entirely rather than padded, which is valid per the schema (an omitted optional element
// simply isn't there -- the sequence constraint only orders the elements that ARE present).

const TASK_TYPE_FIXED_DURATION = 1; // Task.Type: 0=Fixed Units, 1=Fixed Duration, 2=Fixed Work -- Fixed Duration matches this schema's own duration_days-is-authoritative model.
const RESOURCE_TYPE_TO_MSP = Object.freeze({ material: 0, labor: 1, nonlabor: 1 }); // Resource.Type: 0=Material, 1=Work, 2=Cost. Project has no distinct "equipment" type -- nonlabor maps to Work, same as labor, a real named simplification.
// PredecessorLink.Type: 0=FF, 1=FS, 2=SF, 3=SS -- a completely different numbering than XER's
// alphabetical PR_FS/etc (SCHED-12), deliberately not reused from that module.
const RELATIONSHIP_TYPE_TO_MSP = Object.freeze({ FF: 0, FS: 1, SF: 2, SS: 3 });
// ConstraintType: 0=ASAP, 1=ALAP, 2=Must Start On, 3=Must Finish On, 4=SNET, 5=SNLT, 6=FNET,
// 7=FNLT. Same fidelity loss as XER's cstr_type mapping: Project has no separate soft/hard pair
// (start_on vs. must_start_on), both collapse to the same code.
const CONSTRAINT_TYPE_TO_MSP = Object.freeze({
  ALAP: 1, start_on: 2, must_start_on: 2, finish_on: 3, must_finish_on: 3,
  SNET: 4, SNLT: 5, FNET: 6, FNLT: 7,
});
// AccrueAt: 1=Start, 2=Prorated, 3=End -- a widely-cited mapping, but NOT independently verified
// via a fetched Microsoft Learn page this session (unlike every other enum in this module).
const ACCRUAL_TYPE_TO_MSP = Object.freeze({ start: 1, uniform: 2, end: 3 });

const HOURS_PER_DAY = 8; // same uniform-8-hour-workday assumption as schedulingXerExport.js.

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
// Omits the element entirely when value is null/undefined -- valid per this schema's minOccurs="0"
// optional fields, and simpler than emitting an empty tag whose meaning would be ambiguous (empty
// string vs. "not provided").
function tag(name, value) {
  return value == null || value === "" ? "" : `<${name}>${xmlEscape(value)}</${name}>`;
}
function isoDuration(hours) {
  return `PT${hours}H0M0S`;
}
function isoDateTime(dateISO) {
  return dateISO == null ? null : `${dateISO}T00:00:00`;
}

function createIdAllocator() {
  let next = 1;
  const idsByKey = new Map();
  return (key) => {
    if (key == null) return null;
    if (!idsByKey.has(key)) idsByKey.set(key, next++);
    return idsByKey.get(key);
  };
}

// WeekDay.DayType: 1=Sunday..7=Saturday, matching this schema's own working_days convention
// (0=Sun..6=Sat) shifted by one -- the same numbering XER's clndr_data happened to use too
// (SCHED-12), though that's coincidence, not reuse (the two formats are otherwise unrelated).
// Exceptions (holidays): one per holiday date, DayWorking=0 across a single-day TimePeriod. This
// specific FromDate/ToDate-both-same-day formatting was NOT independently verified against a real
// Project-generated sample the way the rest of this schema was (see the module header) -- flagged
// with the same honesty bar as AccrueAt, the module's other unverified-but-reasonable mapping.
function buildCalendarXml(calendar, xid, holidayDatesISO = []) {
  const workingSet = new Set(calendar.working_days);
  const weekDays = [];
  for (let dayType = 1; dayType <= 7; dayType += 1) {
    const isWorking = workingSet.has(dayType - 1);
    weekDays.push(
      `<WeekDay>${tag("DayType", dayType)}${tag("DayWorking", isWorking ? 1 : 0)}`
      + (isWorking ? `<WorkingTimes><WorkingTime>${tag("FromTime", "08:00:00")}${tag("ToTime", `${8 + HOURS_PER_DAY}:00:00`)}</WorkingTime></WorkingTimes>` : "")
      + `</WeekDay>`,
    );
  }
  const exceptions = holidayDatesISO.map((dateISO) => (
    `<Exception><TimePeriod>${tag("FromDate", isoDateTime(dateISO))}${tag("ToDate", isoDateTime(dateISO))}</TimePeriod>${tag("DayWorking", 0)}</Exception>`
  ));
  return `<Calendar>${tag("UID", xid(calendar.id))}${tag("Name", calendar.name)}${tag("IsBaseCalendar", 1)}`
    + `<WeekDays>${weekDays.join("")}</WeekDays>`
    + (exceptions.length > 0 ? `<Exceptions>${exceptions.join("")}</Exceptions>` : "")
    + `</Calendar>`;
}

function buildTaskXml(block, xid, defaultCalendarId) {
  const durationHours = (block.duration_days ?? 0) * HOURS_PER_DAY;
  const isMilestone = block.block_type === "milestone";
  const constraintCode = block.constraint_type ? CONSTRAINT_TYPE_TO_MSP[block.constraint_type] : null;

  const predecessorLinks = (block.predecessors ?? []).map((dependency) => (
    `<PredecessorLink>${tag("PredecessorUID", xid(dependency.predecessor_id))}${tag("Type", RELATIONSHIP_TYPE_TO_MSP[dependency.relationship_type] ?? 1)}`
    // LinkLag unit is tenths of a minute (confirmed via Microsoft Learn) -- lag_days is CALENDAR
    // days per this schema's own CPM engine (real elapsed time, not working time -- see
    // schedulingCpmEngine.js), so the conversion is lag_days * 24h * 60m * 10, not a working-day
    // or working-hour figure.
    + `${tag("LinkLag", (dependency.lag_days ?? 0) * 24 * 60 * 10)}${tag("LagFormat", 7)}</PredecessorLink>`
  )).join("");

  return `<Task>${tag("UID", xid(block.id))}${tag("ID", xid(block.id))}${tag("Name", block.label)}${tag("Type", TASK_TYPE_FIXED_DURATION)}`
    + `${tag("WBS", block.task_code)}`
    + `${tag("Start", isoDateTime(block.early_start))}${tag("Finish", isoDateTime(block.early_finish))}`
    + `${tag("Duration", isoDuration(durationHours))}${tag("DurationFormat", 7)}`
    + `${tag("Milestone", isMilestone ? 1 : 0)}${tag("Critical", block.is_critical ? 1 : 0)}`
    + `${tag("EarlyStart", isoDateTime(block.early_start))}${tag("EarlyFinish", isoDateTime(block.early_finish))}`
    + `${tag("LateStart", isoDateTime(block.late_start))}${tag("LateFinish", isoDateTime(block.late_finish))}`
    + `${tag("PercentComplete", block.percent_complete ?? 0)}`
    + `${tag("ActualStart", isoDateTime(block.actual_start))}${tag("ActualFinish", isoDateTime(block.actual_finish))}`
    + (constraintCode != null ? `${tag("ConstraintType", constraintCode)}${tag("ConstraintDate", isoDateTime(block.constraint_date))}` : "")
    + `${tag("CalendarUID", xid(block.calendar_id || defaultCalendarId))}`
    + predecessorLinks
    + `</Task>`;
}

function buildResourceXml(resource, xid, defaultCalendarId) {
  return `<Resource>${tag("UID", xid(resource.id))}${tag("ID", xid(resource.id))}${tag("Name", resource.name)}`
    + `${tag("Type", RESOURCE_TYPE_TO_MSP[resource.resource_type] ?? 1)}`
    + `${tag("MaxUnits", (resource.max_units_per_day ?? HOURS_PER_DAY) / HOURS_PER_DAY)}`
    + `${tag("StandardRate", resource.std_rate ?? 0)}${tag("StandardRateFormat", 2)}`
    + `${tag("CalendarUID", xid(resource.calendar_id || defaultCalendarId))}`
    + `</Resource>`;
}

// Units (a fraction of the resource's own calendar capacity, 1.0 = 100%) has no equivalent
// concept in this schema -- always exported as 1.0 (full allocation for the assignment's
// duration); Work (the real total-hours commitment) carries the actual budgeted quantity. A
// judgment call, same spirit as XER's RSRC hour-rate conversion.
function buildAssignmentXml(assignment, resourcesById, xid) {
  const resource = resourcesById.get(assignment.resource_id);
  const rate = assignment.rate_override ?? resource?.std_rate ?? 0;
  const targetUnits = assignment.budgeted_units ?? 0;
  const actualUnits = assignment.actual_units ?? 0;
  return `<Assignment>${tag("UID", xid(assignment.id ?? `${assignment.block_id}:${assignment.resource_id}`))}`
    + `${tag("TaskUID", xid(assignment.block_id))}${tag("ResourceUID", xid(assignment.resource_id))}`
    + `${tag("PercentWorkComplete", targetUnits > 0 ? Math.round((actualUnits / targetUnits) * 100) : 0)}`
    + `${tag("ActualCost", actualUnits * rate)}${tag("ActualWork", isoDuration(actualUnits))}`
    + `${tag("Cost", targetUnits * rate)}`
    + `${tag("RemainingCost", (targetUnits - actualUnits) * rate)}${tag("RemainingWork", isoDuration(targetUnits - actualUnits))}`
    + `${tag("Units", 1)}${tag("Work", isoDuration(targetUnits))}`
    + `</Assignment>`;
}

export function exportProjectToProjectXml({
  project, calendars = [], holidays = [], blocks = [], dependencies = [], resources = [], assignments = [], exportedAtISO,
}) {
  const xid = createIdAllocator();

  const effectiveCalendars = calendars.length > 0 ? calendars : [{ id: "__default_calendar__", name: "Standard", working_days: [1, 2, 3, 4, 5], schedule_project_id: null }];
  const defaultCalendarId = project.default_calendar_id && calendars.some((calendar) => calendar.id === project.default_calendar_id)
    ? project.default_calendar_id
    : effectiveCalendars[0].id;

  const holidaysByCalendarId = new Map();
  for (const holiday of holidays) {
    if (!holidaysByCalendarId.has(holiday.calendar_id)) holidaysByCalendarId.set(holiday.calendar_id, []);
    holidaysByCalendarId.get(holiday.calendar_id).push(holiday.holiday_date);
  }

  // PredecessorLink nests inside Task (unlike XER's separate TASKPRED table) -- group dependencies
  // by successor once, up front, rather than filtering the whole array per task.
  const dependenciesBySuccessor = new Map();
  for (const dependency of dependencies) {
    if (!dependenciesBySuccessor.has(dependency.successor_id)) dependenciesBySuccessor.set(dependency.successor_id, []);
    dependenciesBySuccessor.get(dependency.successor_id).push(dependency);
  }
  const blocksWithPredecessors = blocks.map((block) => ({ ...block, predecessors: dependenciesBySuccessor.get(block.id) ?? [] }));

  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));

  const calendarsXml = effectiveCalendars.map((calendar) => buildCalendarXml(calendar, xid, holidaysByCalendarId.get(calendar.id) ?? [])).join("");
  const tasksXml = blocksWithPredecessors.map((block) => buildTaskXml(block, xid, defaultCalendarId)).join("");
  const resourcesXml = resources.map((resource) => buildResourceXml(resource, xid, defaultCalendarId)).join("");
  const assignmentsXml = assignments.map((assignment) => buildAssignmentXml(assignment, resourcesById, xid)).join("");

  const body = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<Project xmlns="http://schemas.microsoft.com/project/2007">`,
    tag("SaveVersion", 12),
    tag("Name", project.name),
    tag("StartDate", isoDateTime(project.start_date)),
    tag("FinishDate", isoDateTime(project.end_date)),
    tag("CurrencyDigits", 2), tag("CurrencySymbol", "$"), tag("CurrencyCode", "USD"),
    tag("CalendarUID", xid(defaultCalendarId)),
    tag("DefaultStartTime", "08:00:00"), tag("DefaultFinishTime", `${8 + HOURS_PER_DAY}:00:00`),
    tag("MinutesPerDay", HOURS_PER_DAY * 60), tag("MinutesPerWeek", HOURS_PER_DAY * 60 * 5), tag("DaysPerMonth", 20),
    tag("DefaultTaskType", TASK_TYPE_FIXED_DURATION),
    tag("CurrentDate", isoDateTime((exportedAtISO || new Date().toISOString()).slice(0, 10))),
    `<Calendars>${calendarsXml}</Calendars>`,
    `<Tasks>${tasksXml}</Tasks>`,
    resources.length > 0 ? `<Resources>${resourcesXml}</Resources>` : "",
    assignments.length > 0 ? `<Assignments>${assignmentsXml}</Assignments>` : "",
    "</Project>",
  ];

  return body.filter((part) => part !== "").join("");
}
