// SaaS Auth PR 1 — per-request app-access gate.
//
// Calls the forge_check_app_access RPC (workspace active + entitlement
// active + active membership, or a live support context) and turns a
// denial into a plain-words 403. The RPC itself never trusts the
// caller: it reads auth.uid() server-side and checks the workspace
// row, the entitlement row, and the membership row.
//
// Fail closed: any RPC error (including the function not existing yet
// because the migration has not applied) denies with 503, never 200.
// The merge -> apply -> verify sequence lands the migration before
// the deploy goes live, so the 503 path should never fire in
// production; it exists so a half-applied rollout cannot silently
// pass requests through.
import { NextResponse } from "next/server";

export const FORGE_APP_KEYS = ["designer", "scheduler", "planner", "capture"];

const DENIAL_MESSAGES = {
  WORKSPACE_NOT_FOUND:
    "We couldn't find your workspace. Ask the workspace owner to set it up.",
  WORKSPACE_NOT_ACTIVE:
    "Your workspace isn't active yet. Ask the workspace owner to activate it.",
  NO_MEMBERSHIP:
    "You don't have access to this workspace.",
  ENTITLEMENT_NOT_ACTIVE:
    "This app isn't enabled for your workspace yet. Ask the workspace owner to enable it.",
  // SaaS 30-day trial: the gate returns this reason when the failed
  // entitlement is an expired owner_trial. The data is safe — nothing
  // is deleted at expiry — so the message says so.
  TRIAL_ENDED:
    "Your trial has ended. Your workspace data is safe and has not been deleted. Contact your workspace owner to restore access.",
  CAPABILITY_DENIED:
    "You don't have permission to do that in this app.",
  APP_ROLE_REQUIRED:
    "You don't have a role in this app yet. Ask the workspace owner to assign you one.",
  AUTH_REQUIRED: "Sign in to continue.",
  UNKNOWN_APP: "That app isn't available.",
  UNKNOWN_CAPABILITY: "You don't have permission to do that in this app.",
};

export function appAccessDeniedResponse(reason, appKey = null) {
  let message =
    DENIAL_MESSAGES[reason] ||
    "You don't have access to this app right now.";
  // Capture trial expiry: the cloud library and sync pause, but local
  // capture, recording, and the files on this device keep working —
  // the trial never gates local capture. Say so in the denial.
  if (reason === "TRIAL_ENDED" && appKey === "capture") {
    message +=
      " Local capture, recording, and the files on this device keep working — only the cloud library and sync are paused.";
  }
  return NextResponse.json({ error: message }, { status: 403 });
}

export function appAccessUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Access checks are temporarily unavailable. Try again in a minute.",
    },
    { status: 503 },
  );
}

// Returns { allowed: true, via } or { allowed: false, response }.
// Never throws: an RPC failure is a denial with a 503 response.
export async function checkForgeAppAccess(supabaseClient, ownerId, appKey) {
  if (!FORGE_APP_KEYS.includes(appKey)) {
    return { allowed: false, response: appAccessDeniedResponse("UNKNOWN_APP") };
  }
  let result;
  try {
    const { data, error } = await supabaseClient.rpc("forge_check_app_access", {
      p_owner_id: ownerId,
      p_app_key: appKey,
    });
    if (error) throw error;
    result = data;
  } catch (error) {
    console.error("forge_check_app_access failed", error);
    return { allowed: false, response: appAccessUnavailableResponse() };
  }
  if (result?.allowed) {
    return { allowed: true, via: result.via ?? null };
  }
  return {
    allowed: false,
    response: appAccessDeniedResponse(result?.reason, appKey),
  };
}
