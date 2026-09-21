import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { loadProjectRelational, computeCpm } from "../../scheduleProjectAssembly";
import {
  DEFAULT_DRIFT_THRESHOLD_DAYS,
  detectBaselineDrift,
} from "@/domains/scheduling/schedulingDriftAlerts";
import { chicagoTodayISO } from "@/domains/scheduling/schedulingAskSchedule";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Fetches the most recent baseline for the project (if any). Same shape the ask
// route builds: { name, baselineBlocks }. Returns null when no baseline exists.
async function loadLatestBaseline(supabaseClient, projectId) {
  const { data: baseline, error: baselineError } = await supabaseClient
    .from("schedule_baselines")
    .select("id,name")
    .eq("schedule_project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (baselineError) throw baselineError;
  if (!baseline) return null;

  const { data: baselineBlocks, error: blocksError } = await supabaseClient
    .from("schedule_baseline_blocks").select("*").eq("baseline_id", baseline.id);
  if (blocksError) throw blocksError;

  return { name: baseline.name, baselineBlocks: baselineBlocks || [] };
}

// GET /api/forge/scheduling/[projectId]/drift?thresholdDays=2
// Deterministic, read-only baseline drift report: every activity whose current
// start/finish moved beyond the threshold since the latest baseline, with
// severity bands and direction. Never writes -- computeCpm is the pure variant,
// and completed activities are excluded (never flagged as late), matching the
// slice-1 conventions. Visible to anyone who can view the project (dates, CPM,
// and baselines are already non-owner-visible); RLS enforces that boundary.
// thresholdDays is optional; a non-numeric or negative value is a 400.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    const searchParams = request.nextUrl.searchParams;
    const thresholdParam = searchParams.get("thresholdDays");
    let thresholdDays = DEFAULT_DRIFT_THRESHOLD_DAYS;
    if (thresholdParam != null && thresholdParam !== "") {
      const parsed = Number(thresholdParam);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: "thresholdDays must be a non-negative number." },
          { status: 400 },
        );
      }
      thresholdDays = parsed;
    }

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    // Read-only by construction: computeCpm never writes to schedule_blocks, so
    // fetching a drift report cannot mutate CPM data.
    const { cpmBlocks } = await computeCpm(
      authenticated.supabaseClient, relational.project, relational,
    );

    const baseline = await loadLatestBaseline(authenticated.supabaseClient, projectId);
    const report = detectBaselineDrift(
      { blocks: cpmBlocks },
      baseline,
      { thresholdDays, todayISO: chicagoTodayISO() },
    );

    return NextResponse.json({ success: true, thresholdDays, ...report });
  } catch (error) {
    console.error("Scheduling drift error", error);
    return NextResponse.json({ error: "Unable to compute drift right now." }, { status: 500 });
  }
}
