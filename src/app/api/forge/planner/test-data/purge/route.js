// FORGE Planner owner-only test data: delete a test client and its
// sample packages (migration 20261117130000).
// POST /api/forge/planner/test-data/purge { clientId, digest, requestId, confirmName }
// The digest must match the preview's and the typed name must equal the
// client name. Replaying an identical request returns the stored
// receipt; a mismatched replay conflicts.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { purgePlannerTestData } from "@/application/work-management/plannerTestData";

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
    const result = await purgePlannerTestData(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      clientId: body.clientId,
      digest: body.digest,
      requestId: body.requestId || crypto.randomUUID(),
      confirmName: body.confirmName,
    });
    if (!result.ok) return fail(result);
    return json({ purge: result.purge });
  } catch (error) {
    return serverError("POST /api/forge/planner/test-data/purge", error);
  }
}
