import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Shared auth for the Work Management (Rung 1) API surface.
// owner_id is the EFFECTIVE workspace owner (resolveEffectiveOwnerId):
// active members act within the owner's workspace. The acting user id is
// passed separately as actor — attribution is never isolation.
//
// UI-density redesign: pass the route handler's `request` and a
// ?workspace=<ownerId> query param selects a different workspace the actor
// can act within. The selection is validated inside
// resolveEffectiveOwnerId (own id or an active membership only); an
// unvalidated value falls back to the default resolution, so a crafted
// param can never widen access. Callers that pass no request keep today's
// behavior.
export async function workAuth(request) {
  let requestedOwnerId = null;
  if (request?.url) {
    try {
      requestedOwnerId = new URL(request.url).searchParams.get("workspace");
    } catch {
      requestedOwnerId = null;
    }
  }
  const authenticated = await createAuthenticatedForgeApplication({ requestedOwnerId });
  if (authenticated.response) return { error: authenticated.response };
  return {
    db: authenticated.supabaseClient,
    ownerId: authenticated.effectiveOwnerId,
    actor: authenticated.user.id,
  };
}

export function ok(body, status = 200) {
  return NextResponse.json(body, { status });
}

export function fail(result) {
  return NextResponse.json({
    error: result.error || "Request failed.",
    ...(result.blockers ? { blockers: result.blockers } : {}),
    ...(result.affectedStepIds ? { affectedStepIds: result.affectedStepIds } : {}),
  }, { status: result.httpStatus || 400 });
}

export function serverError(where, error) {
  console.error(where, error);
  return NextResponse.json({ error: "Unable to complete the request." }, { status: 500 });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
