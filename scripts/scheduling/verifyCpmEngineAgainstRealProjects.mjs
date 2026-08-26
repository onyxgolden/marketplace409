// Read-only sanity check of schedulingCpmEngine.js against real Production data. Fetches every
// schedule_projects row and its related rows (blocks/dependencies/calendars/holidays/hammock
// anchors/lanes), runs runCpmEngine in-process, and reports per-project counts and any anomalies.
// Never calls .update()/.insert()/.delete() -- this is a verification tool for the CPM engine
// module before any write-back or UI cutover exists, not a migration or backfill script.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runCpmEngine } from "../../src/domains/scheduling/schedulingCpmEngine.js";

async function fetchAll(supabaseClient, table) {
  const { data, error } = await supabaseClient.from(table).select("*");
  if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
  return data ?? [];
}

function summarizeProject(project, result) {
  const rows = result.blocks;
  const computedRows = rows.filter((row) => row.early_start !== null && row.early_start !== undefined);
  const excludedBlockIds = rows.filter((row) => row.early_start === null || row.early_start === undefined).map((row) => row.id);
  const floats = computedRows.map((row) => row.total_float_days).filter((value) => typeof value === "number");
  const outOfBoundsBlockIds = computedRows
    .filter((row) => row.early_finish && row.early_finish > project.end_date)
    .map((row) => row.id);
  const criticalPath = computedRows
    .filter((row) => row.is_critical)
    .sort((a, b) => (a.early_start < b.early_start ? -1 : a.early_start > b.early_start ? 1 : a.task_code.localeCompare(b.task_code)))
    .map((row) => row.task_code);
  const conflictsByType = {};
  for (const conflict of result.conflicts) {
    conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
  }

  return Object.freeze({
    projectId: project.id,
    ownerId: project.owner_id,
    projectName: project.name,
    blockCount: rows.length,
    computedBlockCount: computedRows.length,
    excludedBlockIds,
    minFloatDays: floats.length ? Math.min(...floats) : null,
    maxFloatDays: floats.length ? Math.max(...floats) : null,
    outOfBoundsBlockIds,
    criticalPath,
    conflictsByType,
    conflictCount: result.conflicts.length,
  });
}

export async function verifyCpmEngineAgainstRealProjects({ supabaseClient }) {
  const [projects, blocks, dependencies, calendars, holidays, hammockAnchors, lanes] = await Promise.all([
    fetchAll(supabaseClient, "schedule_projects"),
    fetchAll(supabaseClient, "schedule_blocks"),
    fetchAll(supabaseClient, "schedule_dependencies"),
    fetchAll(supabaseClient, "schedule_calendars"),
    fetchAll(supabaseClient, "schedule_calendar_holidays"),
    fetchAll(supabaseClient, "schedule_hammock_anchors"),
    fetchAll(supabaseClient, "schedule_lanes"),
  ]);

  return Object.freeze(
    projects.map((project) => {
      const projectBlocks = blocks.filter((row) => row.owner_id === project.owner_id && row.schedule_project_id === project.id);
      const blockIds = new Set(projectBlocks.map((row) => row.id));
      const projectDependencies = dependencies.filter(
        (row) => row.owner_id === project.owner_id && (blockIds.has(row.predecessor_id) || blockIds.has(row.successor_id)),
      );
      const projectCalendars = calendars.filter((row) => row.owner_id === project.owner_id && row.schedule_project_id === project.id);
      const calendarIds = new Set(projectCalendars.map((row) => row.id));
      const projectHolidays = holidays.filter((row) => row.owner_id === project.owner_id && calendarIds.has(row.calendar_id));
      const projectHammockAnchors = hammockAnchors.filter((row) => row.owner_id === project.owner_id && blockIds.has(row.hammock_block_id));
      const projectLanes = lanes.filter((row) => row.owner_id === project.owner_id && row.schedule_project_id === project.id);

      const result = runCpmEngine({
        project,
        blocks: projectBlocks,
        dependencies: projectDependencies,
        calendars: projectCalendars,
        holidays: projectHolidays,
        hammockAnchors: projectHammockAnchors,
        lanes: projectLanes,
      });

      return summarizeProject(project, result);
    }),
  );
}

export function formatReport(reports) {
  const lines = [];
  for (const report of reports) {
    lines.push(`Project ${report.projectId} (${report.projectName}), owner ${report.ownerId}`);
    lines.push(`  blocks: ${report.computedBlockCount}/${report.blockCount} computed`);
    if (report.excludedBlockIds.length) lines.push(`  excluded (cyclic/hammock-anomaly): ${report.excludedBlockIds.join(", ")}`);
    lines.push(`  float: min ${report.minFloatDays ?? "n/a"}, max ${report.maxFloatDays ?? "n/a"}`);
    if (report.outOfBoundsBlockIds.length) lines.push(`  ANOMALY early_finish past project end_date: ${report.outOfBoundsBlockIds.join(", ")}`);
    lines.push(`  critical path: ${report.criticalPath.length ? report.criticalPath.join(" -> ") : "(none)"}`);
    if (report.conflictCount) {
      const byType = Object.entries(report.conflictsByType).map(([type, count]) => `${type}=${count}`).join(", ");
      lines.push(`  conflicts (${report.conflictCount}): ${byType}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  // Uses Next.js's own env loader (.env.production.local/.env.local/.env, in that precedence)
  // instead of `node --env-file`, which has been observed to mis-load quoted values written by
  // `vercel env pull`.
  const nextEnv = await import("@next/env");
  const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default.loadEnvConfig;
  loadEnvConfig(process.cwd(), false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    process.stderr.write("Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n");
    process.exitCode = 1;
  } else {
    const supabaseClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const reports = await verifyCpmEngineAgainstRealProjects({ supabaseClient });
    process.stdout.write(formatReport(reports));
    const anomalyCount = reports.reduce((sum, report) => sum + report.outOfBoundsBlockIds.length, 0);
    if (anomalyCount > 0) process.exitCode = 1;
  }
}
