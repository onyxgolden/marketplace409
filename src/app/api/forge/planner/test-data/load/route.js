// FORGE Planner owner-only test data: load the six fictional sample
// packages / 31 steps into a test project (migration 20261117130000).
// POST /api/forge/planner/test-data/load { projectId, requestId }
// The load is owner-only and idempotent; the service maps the RPC
// errors to plain-English, non-disclosing results.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { loadPlannerTestSamples } from "@/application/work-management/plannerTestData";

function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

function fail(result) {
  return json({ error: result.error }, result.httpStatus || 400);
}

function serverError(route, error) {
  console.error(route, error);
  return json({ error: "Unable to complete the request." }, 500);
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    const result = await loadPlannerTestSamples(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      projectId: body.projectId,
      requestId: body.requestId || crypto.randomUUID(),
    });
    if (!result.ok) return fail(result);
    return json({ load: result.load });
  } catch (error) {
    return serverError("POST /api/forge/planner/test-data/load", error);
  }
}
