import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Shared auth for the Work Management (Rung 1) API surface.
// owner_id is the EFFECTIVE workspace owner (resolveEffectiveOwnerId):
// active members act within the owner's workspace. The acting user id is
// passed separately as actor — attribution is never isolation.
export async function workAuth() {
  const authenticated = await createAuthenticatedForgeApplication();
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
