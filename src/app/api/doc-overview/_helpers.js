// FORGE Doc-to-Overview — slice B: shared route helpers (not a route).
//
// Every doc-overview route authenticates through
// createAuthenticatedForgeApplication and binds the draft store to the
// EFFECTIVE owner id (the workspace-aware owner identity the rest of
// FORGE scopes data by — see resolveEffectiveOwnerId). The actor
// recorded on review actions is the authenticated user id, derived from
// the session, never from the request body. A cross-owner request
// finds nothing (the identity-bound store returns null), which the
// routes report as 404 — never a leak about another owner's records.
//
// The store root is DOC_OVERVIEW_ROOT (env) or data/doc-overview
// (gitignored). No route here makes a network call, touches a
// scheduler, or writes agent memory.

import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createDocOverviewStore } from "@/application/doc-overview/generate.js";

const ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_MANIFEST: 400,
  INVALID_DOCUMENTS: 400,
  INVALID_ACTOR: 400,
  INVALID_ARTIFACT: 400,
  INVALID_ACTION: 400,
  INVALID_EDIT: 400,
  INVALID_CONTENT: 400,
  TOTAL_OVERSIZED: 413,
  EDIT_TOO_LARGE: 413,
  CONTENT_TOO_LARGE: 413,
  STALE_SOURCE: 409,
  MISSING_SOURCE: 409,
  PAGE_CONTENT_MISMATCH: 409,
  PAGE_BINDING_MISSING: 409,
  NOT_EXPORTABLE: 409,
  ILLEGAL_TRANSITION: 409,
  CITATION_AUDIT_FAILED: 422,
};

export function errorResponse(error) {
  const code = error?.code ?? "INTERNAL_ERROR";
  const status = ERROR_STATUS[code] ?? 500;
  return NextResponse.json(
    { error: error?.message ?? "An unexpected error occurred.", code },
    { status },
  );
}

/**
 * Authenticates the request and returns { store, actorId } — or a
 * Response to return directly when unauthenticated. The store is
 * identity-bound to the effective owner id; methods take no ownerId,
 * so no request value can reach another owner's artifacts.
 */
export async function requireDocOverviewStore() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return { response: authenticated.response };
  const store = createDocOverviewStore({ ownerId: authenticated.effectiveOwnerId });
  return { store, actorId: authenticated.user.id };
}

export function isRecordId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    && !value.includes("/") && !value.includes("\\") && value !== "." && value !== ".."
    && !value.startsWith(".");
}
