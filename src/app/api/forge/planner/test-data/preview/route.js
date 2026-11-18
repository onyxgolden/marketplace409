// FORGE Planner owner-only test data: preview a test-client purge
// (migration 20261117130000).
// POST /api/forge/planner/test-data/preview { clientId }
// Returns the counts, blockers, and the digest the purge must be
// confirmed against. Owner-only; a non-owner gets the same 404 as for
// a missing client.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { previewPlannerTestPurge } from "@/application/work-management/plannerTestData";

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
    const result = await previewPlannerTestPurge(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      clientId: body.clientId,
    });
    if (!result.ok) return fail(result);
    return json({ preview: result.preview });
  } catch (error) {
    return serverError("POST /api/forge/planner/test-data/preview", error);
  }
}
