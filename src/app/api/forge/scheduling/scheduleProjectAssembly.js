// Shared between GET /api/forge/scheduling/[projectId] and the SCHED-04 baseline endpoints --
// both need "the project's current relational data" and "a fresh CPM run over it." Not a
// src/domains/scheduling module: those are all pure (no I/O), and this does real Supabase reads/
// writes, so it lives alongside the routes that use it instead.
import { runCpmEngine } from "@/domains/scheduling/schedulingCpmEngine";
import { diagnoseCycles } from "@/domains/scheduling/schedulingCycleDiagnosis";

// Every relational table directly scoped by schedule_project_id -- schedule_dependencies and
// schedule_hammock_anchors have no such column (see the relational schema migration) and are
// fetched separately, filtered by the block ids these tables already gave us.
export const PROJECT_SCOPED_TABLES = [
  ["calendars", "schedule_calendars"],
  ["wbsNodes", "schedule_wbs_nodes"],
  ["blackoutWindows", "schedule_blackout_windows"],
  ["lanes", "schedule_lanes"],
  ["blocks", "schedule_blocks"],
];

// Returns { project: null } (not an error) when the project doesn't exist or isn't visible to the
// caller -- RLS already restricts this to the caller's own rows plus any is_public=true row (and,
// via the public-select policies added alongside sync_schedule_project_from_board, every other
// schedule_* table scoped to that same project), so a miss here means "doesn't exist" and "exists
// but isn't yours or public" alike, both correctly surfacing the same way to every caller.
export async function loadProjectRelational(supabaseClient, projectId) {
  const { data: project, error: projectError } = await supabaseClient
    .from("schedule_projects").select("*").eq("id", projectId).maybeSingle();
  if (projectError) throw projectError;
  if (!project) return { project: null };

  const results = await Promise.all(
    PROJECT_SCOPED_TABLES.map(([, table]) => supabaseClient.from(table).select("*").eq("schedule_project_id", projectId)),
  );
  const failedScoped = results.find((result) => result.error);
  if (failedScoped) throw failedScoped.error;
  const relational = { project, ...Object.fromEntries(PROJECT_SCOPED_TABLES.map(([key], index) => [key, results[index].data || []])) };

  const blockIds = relational.blocks.map((block) => block.id);
  const { data: dependencies, error: dependenciesError } = blockIds.length
    ? await supabaseClient.from("schedule_dependencies").select("*").in("predecessor_id", blockIds)
    : { data: [], error: null };
  if (dependenciesError) throw dependenciesError;
  relational.dependencies = dependencies || [];

  return relational;
}

// Runs the real CPM engine over a project's Gantt blocks (WBS activities have no dependency graph
// and are excluded -- lane_id is what distinguishes a Gantt block from a WBS activity, see
// schedulingRelationalToBoard.js), keyed by task_code (never namespaced, unlike every other id
// here) so callers can look up a block's CPM result without needing to know about relational ids.
// Also best-effort persists the computed dates back onto schedule_blocks so baseline capture always
// has fresh early/late/float data -- failures here are logged, never fail the caller. `cpmBlocks` is
// the raw runCpmEngine output (full rows, not just the summary), which captureBaseline needs as-is.
export async function computeAndPersistCpm(supabaseClient, project, relational) {
  const ganttBlocks = relational.blocks.filter((block) => block.lane_id != null && block.block_type !== "hammock");
  if (ganttBlocks.length === 0) return { byTaskCode: {}, criticalTaskCodes: [], conflicts: [], cycleDiagnoses: [], cpmBlocks: [] };

  const blockIds = new Set(relational.blocks.map((block) => block.id));
  const dependencies = relational.dependencies.filter((dependency) => blockIds.has(dependency.predecessor_id) && blockIds.has(dependency.successor_id));

  const result = runCpmEngine({
    project: { start_date: project.start_date, end_date: project.end_date, default_calendar_id: project.default_calendar_id },
    blocks: ganttBlocks, dependencies, calendars: relational.calendars, holidays: [], hammockAnchors: [], lanes: relational.lanes,
  });

  const byTaskCode = {};
  const criticalTaskCodes = [];
  await Promise.all(result.blocks.map(async (block) => {
    byTaskCode[block.task_code] = {
      earlyStart: block.early_start, earlyFinish: block.early_finish,
      lateStart: block.late_start, lateFinish: block.late_finish,
      totalFloatDays: block.total_float_days, isCritical: block.is_critical,
      // Already fetched on every schedule_blocks row (SCHED-02) but never surfaced until SCHED-04's
      // progress-tracking UI needed somewhere to read a Gantt block's current values from -- the
      // legacy board.blocks jsonb shape never learned these fields, so this piggybacks on data
      // already being fetched here rather than teaching the whole board round-trip about them.
      percentComplete: block.percent_complete ?? 0, actualStart: block.actual_start ?? null, actualFinish: block.actual_finish ?? null,
    };
    if (block.is_critical) criticalTaskCodes.push(block.task_code);
    const { error } = await supabaseClient.from("schedule_blocks").update({
      early_start: block.early_start, early_finish: block.early_finish,
      late_start: block.late_start, late_finish: block.late_finish,
      total_float_days: block.total_float_days, is_critical: block.is_critical,
    }).eq("owner_id", block.owner_id).eq("id", block.id);
    if (error) console.error("CPM persist error for block", block.id, error);
  }));

  // SCHED-11: only trace/rank cycles when the CPM engine actually reported one -- diagnoseCycles
  // does a real graph walk, not worth running on every request when the common case has no cycle.
  const hasCycleConflict = result.conflicts.some((conflict) => conflict.type === "cycle");
  const cycleDiagnoses = hasCycleConflict ? diagnoseCycles({ blocks: ganttBlocks, dependencies }) : [];

  return { byTaskCode, criticalTaskCodes, conflicts: result.conflicts, cycleDiagnoses, cpmBlocks: result.blocks };
}

// SCHED-06: resources are an owner-global dictionary (schedule_resources has no
// schedule_project_id -- see the SCHED-05 migration), so they're fetched by owner (RLS-scoped, no
// explicit filter needed) rather than by project. Assignments/expenses ARE project-scoped, but only
// indirectly (via block_id, not a direct schedule_project_id column), so they're fetched by the
// project's own block ids, which `relational` (loadProjectRelational's return value) already has.
export async function loadResourceCostData(supabaseClient, relational) {
  const blockIds = relational.blocks.map((block) => block.id);
  const [resourcesResult, costAccountsResult, assignmentsResult, expensesResult] = await Promise.all([
    supabaseClient.from("schedule_resources").select("*").order("name"),
    supabaseClient.from("schedule_cost_accounts").select("*").order("code"),
    blockIds.length ? supabaseClient.from("schedule_resource_assignments").select("*").in("block_id", blockIds) : { data: [], error: null },
    blockIds.length ? supabaseClient.from("schedule_expenses").select("*").in("block_id", blockIds) : { data: [], error: null },
  ]);
  const failed = [resourcesResult, costAccountsResult, assignmentsResult, expensesResult].find((result) => result.error);
  if (failed) throw failed.error;

  return {
    resources: resourcesResult.data || [],
    costAccounts: costAccountsResult.data || [],
    assignments: assignmentsResult.data || [],
    expenses: expensesResult.data || [],
  };
}

// SCHED-13/15: shared prep for any full-schedule export (XER, Project XML, ...). Every exporter
// needs the same three things beyond loadProjectRelational's own data: every calendar actually
// referenced -- including a reusable/global one (schedule_project_id IS NULL) outside this
// project's own scoped rows, which loadProjectRelational's fetch misses entirely -- that
// calendar's holidays, and dependencies/assignments filtered down to the blocks actually being
// exported (cpmBlocks), so neither an exporter's predecessor-link table nor its assignment table
// can reference a block id that isn't in the file's own task table.
export async function loadExportData(supabaseClient, relational, cpmBlocks, assignments) {
  const referencedCalendarIds = new Set([
    relational.project.default_calendar_id,
    ...relational.lanes.map((lane) => lane.calendar_id),
    ...cpmBlocks.map((block) => block.calendar_id),
  ].filter(Boolean));
  const missingCalendarIds = [...referencedCalendarIds].filter((id) => !relational.calendars.some((calendar) => calendar.id === id));
  let calendars = relational.calendars;
  if (missingCalendarIds.length > 0) {
    const { data: extraCalendars, error: extraCalendarsError } = await supabaseClient.from("schedule_calendars").select("*").in("id", missingCalendarIds);
    if (extraCalendarsError) throw extraCalendarsError;
    calendars = [...calendars, ...(extraCalendars || [])];
  }

  const calendarIds = calendars.map((calendar) => calendar.id);
  const { data: holidays, error: holidaysError } = calendarIds.length
    ? await supabaseClient.from("schedule_calendar_holidays").select("*").in("calendar_id", calendarIds)
    : { data: [], error: null };
  if (holidaysError) throw holidaysError;

  const cpmBlockIds = new Set(cpmBlocks.map((block) => block.id));
  const dependencies = relational.dependencies.filter((dependency) => cpmBlockIds.has(dependency.predecessor_id) && cpmBlockIds.has(dependency.successor_id));
  const exportAssignments = assignments.filter((assignment) => cpmBlockIds.has(assignment.block_id));

  return { calendars, holidays: holidays || [], dependencies, assignments: exportAssignments };
}

// schedule_resource_assignments/schedule_expenses reference a block by its relational id, not by
// (schedule_project_id, task_code) the way every route so far addresses a block -- this resolves
// one to the other. Returns null (not a thrown error) for "doesn't exist or isn't this owner's",
// matching this API's established not-found-vs-error split; callers turn a null into a 404.
export async function resolveOwnedBlock(supabaseClient, ownerId, projectId, taskCode) {
  const { data, error } = await supabaseClient.from("schedule_blocks").select("id")
    .eq("schedule_project_id", projectId).eq("task_code", taskCode).eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  return data;
}
