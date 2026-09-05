import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { computeScheduleVariance, rollupProjectVariance } from "@/domains/scheduling/schedulingBaselines";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, baselineId } = await params;

    const { data: baselineBlocks, error: baselineBlocksError } = await authenticated.supabaseClient
      .from("schedule_baseline_blocks").select("*").eq("baseline_id", baselineId);
    if (baselineBlocksError) throw baselineBlocksError;

    // An empty result could be a genuinely empty baseline (captured from a board with no blocks
    // yet) or a baseline that doesn't exist/isn't visible to this caller -- the baseline row itself
    // (scoped to this project) is what tells those apart.
    if (!baselineBlocks || baselineBlocks.length === 0) {
      const { data: baseline, error: baselineError } = await authenticated.supabaseClient
        .from("schedule_baselines").select("id").eq("id", baselineId).eq("schedule_project_id", projectId).maybeSingle();
      if (baselineError) throw baselineError;
      if (!baseline) return NextResponse.json({ error: "Baseline not found." }, { status: 404 });
    }

    // Only Gantt blocks (lane_id set) -- WBS activities were never part of the CPM run a baseline
    // snapshots from, so comparing against them here would be comparing against data that was
    // never in the baseline to begin with.
    const { data: currentBlocks, error: currentBlocksError } = await authenticated.supabaseClient
      .from("schedule_blocks").select("*").eq("schedule_project_id", projectId).not("lane_id", "is", null);
    if (currentBlocksError) throw currentBlocksError;

    const variance = computeScheduleVariance({ baselineBlocks: baselineBlocks || [], currentBlocks: currentBlocks || [] });
    const rollup = rollupProjectVariance({ baselineBlocks: baselineBlocks || [], currentBlocks: currentBlocks || [] });

    return NextResponse.json({ success: true, ...variance, rollup });
  } catch (error) {
    console.error("Scheduling baseline variance error", error);
    return NextResponse.json({ error: "Unable to compute variance for this baseline." }, { status: 500 });
  }
}
