// SaaS Auth PR 1 — shared handler for the /api/forge/auth/* RPC routes.
//
// Every route is a thin, authenticated wrapper around one SECURITY
// DEFINER RPC: the RPC enforces authority (owner / co-owner /
// workspace_admin ceiling / platform owner), idempotency, and
// auditing; this layer only authenticates, validates the request
// shape, and translates FORGE_AUTH_* failures into plain-words
// HTTP responses. Raw Postgres messages never reach the client.
//
// These routes deliberately do NOT pass an appKey to
// createAuthenticatedForgeApplication: they must be reachable before
// a workspace or app is active (provisioning, invites, grants), and
// each RPC enforces its own authority. A signed-out caller still gets
// 401 from the helper.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

const ERROR_MAP = {
  FORGE_AUTH_ACTOR_REQUIRED: [401, "Sign in to continue."],
  FORGE_AUTH_REQUEST_ID_REQUIRED: [400, "A request id is required. Try again."],
  FORGE_AUTH_REQUEST_ID_CONFLICT: [409, "That request was already used with different details. Start a new request."],
  FORGE_AUTH_REASON_REQUIRED: [400, "A reason is required for this change."],
  FORGE_AUTH_PLATFORM_OWNER_ONLY: [403, "Only a platform owner can do that."],
  FORGE_AUTH_OWNER_ONLY: [403, "Only the workspace owner can do that."],
  FORGE_AUTH_CEILING_EXCEEDED: [403, "A workspace admin can't grant that level of access. Ask the workspace owner."],
  FORGE_AUTH_INVITE_INVALID: [400, "That invitation is invalid or has expired."],
  FORGE_AUTH_INVITE_EXISTS: [409, "An invitation for that person and app is already waiting."],
  FORGE_AUTH_INVITE_FORBIDDEN: [403, "You can't manage invitations for this workspace."],
  FORGE_AUTH_INVITER_REVOKED: [403, "The person who sent this invitation no longer has permission to invite."],
  FORGE_AUTH_SELF_INVITE: [400, "You can't invite yourself."],
  FORGE_AUTH_EMAIL_REQUIRED: [400, "An email address is required."],
  FORGE_AUTH_ROLE_REQUIRED: [400, "A role is required."],
  FORGE_AUTH_ROLE_STALE: [400, "That role no longer exists. Choose a current role and try again."],
  FORGE_AUTH_ROLE_NOT_FOUND: [404, "That role wasn't found."],
  FORGE_AUTH_UNKNOWN_ROLE: [400, "That role isn't recognized."],
  FORGE_AUTH_UNKNOWN_APP: [400, "That app isn't recognized."],
  FORGE_AUTH_UNKNOWN_SOURCE: [400, "That billing source isn't recognized."],
  FORGE_AUTH_UNKNOWN_STATUS: [400, "That workspace status isn't recognized."],
  FORGE_AUTH_WORKSPACE_NOT_FOUND: [404, "That workspace wasn't found."],
  FORGE_AUTH_WORKSPACE_EXISTS: [409, "This workspace already exists."],
  FORGE_AUTH_WORKSPACE_NOT_ACTIVE: [403, "This workspace isn't active."],
  FORGE_AUTH_DISPLAY_NAME_REQUIRED: [400, "A workspace name is required."],
  FORGE_AUTH_ENTITLEMENT_NOT_ACTIVE: [403, "This app isn't enabled for the workspace."],
  FORGE_AUTH_ENTITLEMENT_NOT_FOUND: [404, "That entitlement wasn't found."],
  FORGE_AUTH_TRIAL_UNDECIDED: [400, "Trial grants aren't available yet. A platform owner must approve the trial terms first."],
  FORGE_AUTH_BILLING_WEBHOOK_UNAVAILABLE: [400, "Billing-verified grants aren't available yet."],
  FORGE_AUTH_MEMBER_NOT_FOUND: [404, "That member wasn't found in this workspace."],
  FORGE_AUTH_MEMBER_REVOKED: [409, "That membership was revoked."],
  FORGE_AUTH_ALREADY_MEMBER: [409, "That person is already a member of this workspace."],
  FORGE_AUTH_ALREADY_REVOKED: [409, "That membership is already revoked."],
  FORGE_AUTH_SELF_REVOKE: [400, "You can't revoke your own access."],
  FORGE_AUTH_SELF_ROLE: [400, "You can't change your own role."],
  FORGE_AUTH_USER_NOT_FOUND: [404, "That user wasn't found."],
  FORGE_AUTH_OPERATOR_NOT_FOUND: [404, "That platform operator wasn't found."],
  FORGE_AUTH_PROGRAMMER_NOT_FOUND: [404, "That programmer grant wasn't found."],
  FORGE_AUTH_VERIFICATION_REQUIRED: [400, "Verification details are required for a platform-operator grant."],
  FORGE_AUTH_LAST_OWNER: [400, "The last platform owner can't be removed."],
  FORGE_AUTH_SCOPE_OBJECT: [400, "The programmer scope must be an object."],
  FORGE_AUTH_PURPOSE_REQUIRED: [400, "A purpose is required for a support context."],
  FORGE_AUTH_ACTIONS_ARRAY: [400, "Allowed actions must be a list."],
  FORGE_AUTH_CONTEXT_GRANTEE: [400, "Support contexts can only be granted to an active programmer or support operator."],
  FORGE_AUTH_CONTEXT_TOO_LONG: [400, "A support context can last at most 8 hours."],
  FORGE_AUTH_CONTEXT_NOT_FOUND: [404, "That support context wasn't found."],
  FORGE_AUTH_CONTEXT_NOT_YOURS: [403, "That support context belongs to someone else."],
  FORGE_AUTH_CONTEXT_REVOKED: [403, "That support context was revoked."],
  FORGE_AUTH_CONTEXT_EXPIRED: [403, "That support context has expired."],
  FORGE_AUTH_EXPIRY_PAST: [400, "The expiry must be in the future."],
  FORGE_AUTH_ACTION_SUMMARY_REQUIRED: [400, "Describe what you did under the support context."],
  FORGE_AUTH_ROLE_ASSIGN_FORBIDDEN: [403, "You can't assign roles in this workspace."],
  FORGE_AUTH_ROLE_REVOKE_FORBIDDEN: [403, "You can't revoke roles in this workspace."],
  FORGE_AUTH_ASSIGNMENT_NOT_FOUND: [404, "That person doesn't hold a role in this app."],
  FORGE_AUTH_APP_NOT_CANONICAL: [400, "That app uses its own role system."],
};

function errorResponse(error) {
  const message = String(error?.message || "");
  const code = Object.keys(ERROR_MAP).find((key) => message.includes(key));
  if (code) {
    const [status, text] = ERROR_MAP[code];
    return NextResponse.json({ error: text }, { status });
  }
  // Postgres code fallback (42501 forbidden, 23505 conflict).
  if (error?.code === "42501") {
    return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  if (error?.code === "23505") {
    return NextResponse.json({ error: "That already exists." }, { status: 409 });
  }
  console.error("forge auth RPC failed", error);
  return NextResponse.json({ error: "Unable to complete the request." }, { status: 400 });
}

// POST-only RPC route. `fields` lists the body keys (besides
// request_id) that must be present; `params` maps RPC argument names
// to body keys (or literal values via { literal }).
export async function forgeAuthRpcRoute(request, { rpc, fields = [], params }) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const missing = ["request_id", ...fields].filter(
    (key) => body[key] === undefined || body[key] === null || body[key] === "",
  );
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const rpcParams = {};
  for (const [arg, source] of Object.entries(params)) {
    const value =
      source && typeof source === "object" && "literal" in source
        ? source.literal
        : body[source];
    // Optional params arrive as JSON null, never dropped: PostgREST
    // rejects a call that omits a non-defaulted argument.
    rpcParams[arg] = value === undefined ? null : value;
  }

  const { data, error } = await authenticated.supabaseClient.rpc(rpc, rpcParams);
  if (error) return errorResponse(error);
  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}

// GET route for the read-only access check (used by the workspace
// switcher / app shells to show a plain-words denial before loading
// an app). No request_id needed: reads are side-effect free.
export async function forgeAuthAccessRoute(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const url = new URL(request.url);
  const appKey = url.searchParams.get("app");
  const ownerId = url.searchParams.get("owner") || authenticated.effectiveOwnerId;
  if (!appKey) {
    return NextResponse.json({ error: "An app is required." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("forge_check_app_access", {
    p_owner_id: ownerId,
    p_app_key: appKey,
  });
  if (error) return errorResponse(error);
  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}
