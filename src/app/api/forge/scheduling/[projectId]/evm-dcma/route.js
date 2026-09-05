import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { rollupProjectCost } from "@/domains/scheduling/schedulingResources";
import { rollupProjectVariance } from "@/domains/scheduling/schedulingBaselines";
import { computeEvm, computeDcmaMetrics, dcmaCriticalPathLengthIndex, runCriticalPathTest } from "@/domains/scheduling/schedulingEvmDcma";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm } from "../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Read-only, owner-only -- same reasoning as cost-rollup (EVM/DCMA is built on cost data, which has
// no public-select policy per the SCHED-05 migration's decision).
//
// Query params: `baselineId` (optional -- defaults to the project's most recently captured
// baseline, matching how the Baselines modal's own list is ordered newest-first; omitted entirely
// if the project has none yet, in which case EVM's planned value and DCMA's baseline-dependent
// points degrade gracefully to zero/null rather than erroring -- see schedulingEvmDcma.js) and
// `asOfDate` (optional -- defaults to today, an ISO date the caller is measuring performance as of).
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const url = new URL(request.url);
    const asOfDate = url.searchParams.get("asOfDate") || todayISO();
    let baselineId = url.searchParams.get("baselineId");

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    if (!baselineId) {
      const { data: latestBaseline, error: latestBaselineError } = await authenticated.supabaseClient
        .from("schedule_baselines").select("id").eq("schedule_project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latestBaselineError) throw latestBaselineError;
      baselineId = latestBaseline?.id || null;
    }

    const { data: baselineBlocksRaw, error: baselineBlocksError } = baselineId
      ? await authenticated.supabaseClient.from("schedule_baseline_blocks").select("*").eq("baseline_id", baselineId)
      : { data: [], error: null };
    if (baselineBlocksError) throw baselineBlocksError;
    const baselineBlocks = baselineBlocksRaw || [];

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const { resources, assignments, expenses } = await loadResourceCostData(authenticated.supabaseClient, relational);

    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const costRollup = rollupProjectCost({ assignments, resourcesById, expenses });
    const costByBlockId = new Map(costRollup.byBlock.map((row) => [row.block_id, row]));
    const baselineBlockByTaskCode = new Map(baselineBlocks.map((block) => [block.block_task_code, block]));

    const blockInputs = cpmBlocks.map((block) => {
      const cost = costByBlockId.get(block.id);
      const baselineBlock = baselineBlockByTaskCode.get(block.task_code);
      return {
        taskCode: block.task_code,
        budgetedCost: cost?.budgeted_cost ?? 0,
        actualCost: cost?.actual_cost ?? 0,
        percentComplete: block.percent_complete ?? 0,
        baselineStart: baselineBlock?.baseline_start ?? null,
        baselineFinish: baselineBlock?.baseline_finish ?? null,
      };
    });
    const evm = computeEvm({ asOfDate, blockInputs });

    const dcma = computeDcmaMetrics({
      blocks: cpmBlocks, dependencies: relational.dependencies, assignments, baselineBlocks, asOfDate,
    });

    // Point 13 (CPLI): the "critical path" for this purpose is whichever Gantt block actually
    // drives the project's current finish date (latest early_finish) -- same practical stand-in
    // for "the designated finish milestone" used by runCriticalPathTest below, since this schema
    // has no such flag.
    const variance = rollupProjectVariance({ baselineBlocks, currentBlocks: cpmBlocks });
    const drivingBlock = cpmBlocks.reduce((latest, block) => (block.early_finish && (!latest || block.early_finish > latest.early_finish) ? block : latest), null);
    const cpli = dcmaCriticalPathLengthIndex({
      baselineProjectFinish: variance.baselineProjectFinish, asOfDate, criticalPathTotalFloatDays: drivingBlock?.total_float_days ?? null,
    });

    // Point 12 (Critical Path Test) needs the raw (pre-CPM-persist) blocks/calendars/lanes, not the
    // already-computed cpmBlocks -- it runs its own CPM internally, twice, over a modified copy.
    const criticalPathTest = runCriticalPathTest({
      project: { start_date: relational.project.start_date, end_date: relational.project.end_date, default_calendar_id: relational.project.default_calendar_id },
      blocks: relational.blocks, dependencies: relational.dependencies, calendars: relational.calendars, lanes: relational.lanes,
    });

    return NextResponse.json({ success: true, baselineId, asOfDate, evm, dcma: { ...dcma, cpli: cpli.cpli, criticalPathTest } });
  } catch (error) {
    console.error("Scheduling EVM/DCMA error", error);
    return NextResponse.json({ error: "Unable to compute EVM/DCMA metrics for this project." }, { status: 500 });
  }
}
