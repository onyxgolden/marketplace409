// SCHED-21B1: live validation that sync_schedule_project_from_board (see
// supabase/migrations/20260908000000_add_schedule_backward_compatible_day_precision_sync.sql)
// correctly handles BOTH a legacy (schemaVersion absent, startIdx/duration in weeks) and a
// schema-v2 (schemaVersion: 2, startOffsetDays/durationDays, exact days) board against the real,
// deployed function -- not a mock, not a unit test of the SQL text. This is what Jason's SCHED-21B1
// plan calls "validate both formats through rollback-wrapped calls."
//
// Not a literal SQL `BEGIN ... ROLLBACK`: this codebase has no raw-Postgres-connection tooling
// anywhere (every DB access goes through @supabase/supabase-js's PostgREST client, which has no
// session-level transaction control across separate calls), and introducing a new `pg` dependency
// and a new direct-connection-string credential for one validation script felt disproportionate --
// especially since this session has no way to test that new path itself before handing it off. This
// achieves the same practical guarantee (production is left exactly as it was found) via an
// explicit, clearly-namespaced throwaway project id and a guaranteed try/finally cleanup instead of
// a database-level rollback. If real BEGIN/ROLLBACK semantics matter more than that, worth saying
// so -- this was a judgment call, not an attempt to quietly redefine the requirement.
//
// Never touches any real project: OWNER_ID/PROJECT_ID_PREFIX below are constants no real owner_id
// or schedule project id could ever collide with, and every row this script creates is deleted in
// the finally block, whether the assertions pass or throw.

import { createClient } from "@supabase/supabase-js";

const OWNER_ID = "sched21b1_validation_owner";
const PROJECT_ID_PREFIX = "sched21b1_validation_project_";

function legacyBoard(startDate) {
  return {
    projectName: "SCHED-21B1 legacy validation", startDate, endDate: "2026-12-31",
    lanes: [{ id: "lane1", name: "Lane" }],
    // startIdx: 2, duration: 3 -- deliberately week-aligned, matching every board saved in
    // production today (nothing sends non-week-aligned startIdx/duration; the whole point of the
    // legacy path is it's still driven by whole weeks). Expected: startDate + 2*7 = +14 days,
    // duration_days = 3*7 = 21.
    blocks: [{ id: "b1", taskCode: "A1", laneId: "lane1", label: "Legacy block", category: "eng", milestone: false, startIdx: 2, duration: 3 }],
    dependencies: [], calendars: [], blackoutWindows: [], wbs: { nodes: [], activities: [] },
  };
}

function schemaV2Board(startDate) {
  return {
    schemaVersion: 2,
    projectName: "SCHED-21B1 schema-v2 validation", startDate, endDate: "2026-12-31",
    lanes: [{ id: "lane1", name: "Lane" }],
    // Deliberately non-week-aligned -- the exact case week-rounding used to destroy. Expected:
    // startDate + 3 days exactly, duration_days = 10 exactly, no rounding either direction.
    blocks: [{ id: "b1", taskCode: "A1", laneId: "lane1", label: "Day-precise block", category: "eng", milestone: false, startOffsetDays: 3, durationDays: 10 }],
    dependencies: [], calendars: [], blackoutWindows: [], wbs: { nodes: [], activities: [] },
  };
}

async function cleanup(supabaseClient, projectId) {
  // Mirrors DELETE .../[projectId]'s own two-delete cleanup (see route.js): forge_scheduling_projects
  // has no FK back to schedule_projects, so deleting the JSONB row alone doesn't cascade to the
  // relational mirror; deleting schedule_projects does cascade to schedule_blocks/dependencies/etc.
  await supabaseClient.from("forge_scheduling_projects").delete().eq("owner_id", OWNER_ID).eq("id", projectId);
  await supabaseClient.from("schedule_projects").delete().eq("owner_id", OWNER_ID).eq("id", projectId);
}

async function validateOneFormat(supabaseClient, { label, board, expectedStartDate, expectedDurationDays }) {
  const projectId = `${PROJECT_ID_PREFIX}${label}_${Date.now()}`;
  try {
    const { error: insertError } = await supabaseClient.from("forge_scheduling_projects").insert({ owner_id: OWNER_ID, id: projectId, board });
    if (insertError) throw new Error(`Setup insert failed: ${insertError.message}`);

    const { error: syncError } = await supabaseClient.rpc("sync_schedule_project_from_board", { p_owner_id: OWNER_ID, p_project_id: projectId });
    if (syncError) throw new Error(`sync_schedule_project_from_board failed: ${syncError.message}`);

    const { data: block, error: readError } = await supabaseClient
      .from("schedule_blocks").select("start_date, duration_days").eq("owner_id", OWNER_ID).eq("id", `${projectId}_b1`).maybeSingle();
    if (readError) throw new Error(`Readback failed: ${readError.message}`);
    if (!block) throw new Error("Readback found no schedule_blocks row -- sync did not insert the block at all.");

    const startOk = block.start_date === expectedStartDate;
    const durationOk = block.duration_days === expectedDurationDays;
    return {
      label, pass: startOk && durationOk,
      detail: `start_date: got ${block.start_date}, expected ${expectedStartDate}${startOk ? " OK" : " MISMATCH"} | `
        + `duration_days: got ${block.duration_days}, expected ${expectedDurationDays}${durationOk ? " OK" : " MISMATCH"}`,
    };
  } finally {
    await cleanup(supabaseClient, projectId);
  }
}

async function main() {
  const nextEnv = await import("@next/env");
  const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default.loadEnvConfig;
  loadEnvConfig(process.cwd(), false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    process.stderr.write("Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n");
    process.exitCode = 1;
    return;
  }
  const supabaseClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const results = await Promise.all([
    validateOneFormat(supabaseClient, { label: "legacy", board: legacyBoard("2026-01-05"), expectedStartDate: "2026-01-19", expectedDurationDays: 21 }),
    validateOneFormat(supabaseClient, { label: "schemav2", board: schemaV2Board("2026-01-05"), expectedStartDate: "2026-01-08", expectedDurationDays: 10 }),
  ]);

  for (const result of results) {
    process.stdout.write(`[${result.pass ? "PASS" : "FAIL"}] ${result.label}: ${result.detail}\n`);
  }
  if (results.some((result) => !result.pass)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
