import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Shared auth for the Scheduling admin-permissions API surface, mirroring
// src/app/api/work-packages/_lib/auth.js's shape exactly (that helper is
// already reviewed and merged via PR #767; this is the same pattern, not
// a new design). owner_id is the EFFECTIVE workspace owner
// (createAuthenticatedForgeApplication's own effectiveOwnerId, which
// already honors the validated ?workspace= switcher this app's other
// routes use) -- active members act within the owner's workspace. The
// acting user id is passed separately as actor; attribution is never
// isolation.

export async function schedulingAdminAuth(request) {
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
  return NextResponse.json({ error: result.error || "Request failed." }, { status: result.httpStatus || 400 });
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
