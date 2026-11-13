import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  parseForgeProjectParam,
  provePackageInScope,
  resolvePlannerProjectScope,
} from "@/application/work-management/projectScope";

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
  const authenticated = await createAuthenticatedForgeApplication({ requestedOwnerId, appKey: "planner" });
  if (authenticated.response) return { error: authenticated.response };
  // PR B: one server-side project-scope resolution per request. The
  // ?forgeProject= hint is parsed here and validated through the
  // hierarchy RPC (workspace membership + chain; archived/unknown/
  // cross-owner ids fail non-disclosing). Routes that need scope read
  // auth.scope and return fail(auth.scopeError) when validation
  // failed; routes that do not need scope ignore both fields. A
  // request without the hint resolves to NO_SCOPE (chooser state).
  let scope = { kind: "none" };
  let scopeError = null;
  if (request?.url) {
    try {
      const rawForgeProject = new URL(request.url).searchParams.get("forgeProject");
      const forgeProject = parseForgeProjectParam(rawForgeProject);
      if (forgeProject !== null) {
        const resolved = await resolvePlannerProjectScope(authenticated.supabaseClient, {
          ownerId: authenticated.effectiveOwnerId,
          forgeProject,
        });
        if (resolved.ok) scope = resolved.scope;
        else scopeError = resolved;
      }
    } catch {
      // A malformed URL cannot carry a scope; the request proceeds
      // with NO_SCOPE (the route's scope enforcement still applies).
    }
  }
  return {
    db: authenticated.supabaseClient,
    ownerId: authenticated.effectiveOwnerId,
    actor: authenticated.user.id,
    scope,
    scopeError,
  };
}

export function ok(body, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * PR B: the per-request package-scope gate for every [packageId]
 * route. Call right after `const { packageId } = await params;` —
 * before any service call or direct query. Returns a `fail()`
 * Response when the scope itself was invalid (auth.scopeError) or
 * the package is outside the active scope (non-disclosing 404),
 * or null when the package is proven in scope. A package outside
 * the scope reads exactly like a nonexistent package.
 */
export async function requirePackageScope(auth, packageId) {
  if (auth.scopeError) return fail(auth.scopeError);
  const proof = await provePackageInScope(auth.db, {
    ownerId: auth.ownerId,
    packageId,
    scope: auth.scope,
  });
  if (!proof.ok) return fail(proof);
  return null;
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
