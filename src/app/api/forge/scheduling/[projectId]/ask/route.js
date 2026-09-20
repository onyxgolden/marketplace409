import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { loadProjectRelational, computeCpm } from "../../scheduleProjectAssembly";
import { computeScheduleVariance, rollupProjectVariance } from "@/domains/scheduling/schedulingBaselines";
import {
  SUPPORTED_SCHEDULE_QUESTIONS,
  chicagoTodayISO,
  parseScheduleQuestion,
  answerScheduleQuestion,
} from "@/domains/scheduling/schedulingAskSchedule";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Fetches the most recent baseline for the project (if any) plus its variance
// against the current CPM run. Returns null when no baseline was captured.
async function loadLatestBaselineVariance(supabaseClient, projectId, cpmBlocks) {
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

  const variance = computeScheduleVariance({ baselineBlocks: baselineBlocks || [], currentBlocks: cpmBlocks });
  const rollup = rollupProjectVariance({ baselineBlocks: baselineBlocks || [], currentBlocks: cpmBlocks });
  return {
    name: baseline.name,
    compared: variance.compared,
    addedSinceBaseline: variance.addedSinceBaseline,
    removedSinceBaseline: variance.removedSinceBaseline,
    rollup,
  };
}

// POST /api/forge/scheduling/[projectId]/ask
// Deterministic, read-only "Ask the Schedule": answers a fixed set of questions
// about critical path, constraints, float, late milestones, and baseline
// variance from the live CPM run. No LLM -- unrecognized questions return the
// supported-question list. Visible to anyone who can view the project (dates,
// CPM, and baselines are already non-owner-visible, e.g. the shared example
// project); RLS enforces that boundary.
export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    let question = "";
    try {
      const body = await request.json();
      question = String(body?.question ?? "");
    } catch {
      question = "";
    }

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    // Read-only by construction: computeCpm never writes to schedule_blocks, so
    // asking a question cannot mutate CPM data (and non-owners never attempt a
    // denied UPDATE).
    const { cpmBlocks, conflicts } = await computeCpm(
      authenticated.supabaseClient, relational.project, relational,
    );

    const parsed = parseScheduleQuestion(question);
    let baseline = null;
    if (parsed.type === "baseline_variance") {
      baseline = await loadLatestBaselineVariance(authenticated.supabaseClient, projectId, cpmBlocks);
    }

    const answer = answerScheduleQuestion(parsed, {
      cpmBlocks,
      conflicts,
      baseline,
      todayISO: chicagoTodayISO(),
    });

    return NextResponse.json({
      success: true,
      question: question.trim(),
      questionType: answer.questionType,
      summary: answer.summary,
      items: answer.items,
      supportedQuestions: SUPPORTED_SCHEDULE_QUESTIONS,
    });
  } catch (error) {
    console.error("Scheduling ask error", error);
    return NextResponse.json({ error: "Unable to answer that question right now." }, { status: 500 });
  }
}
