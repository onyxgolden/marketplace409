// Rental Manager admin roles — slice 1: API-layer gates for the new
// framework keys.
//
// The database is the authority: these helpers ask the
// `rental_get_my_effective_permissions` RPC for the caller's effective keys
// in this workspace. The RPC returns the whole catalog for the owner and
// co-owner, and the assigned role's keys for staff — so a single key check
// covers both. The RPCs themselves re-check (defense in depth); these
// gates keep the API from even calling an RPC the caller may not use, and
// give the UI a plain-English 403 instead of a database error.
//
// Use the same { response, authorization } shape as teamAuthorization.js:
//   const gate = await requireRentalAdminKey({ authenticated, key: "rental.roles.manage" });
//   if (gate.response) return gate.response;

import { NextResponse } from "next/server";
import { RENTAL_ADMIN_CAPABILITY_BY_KEY } from "./adminPermissions";

function forbidden(message) {
  return NextResponse.json({ error: message }, { status: 403 });
}

// The caller's effective new-framework keys for this workspace, straight
// from the database. Returns [] (fail-closed) when the RPC errors.
export async function getRentalAdminEffectiveKeys({ supabaseClient, effectiveOwnerId }) {
  try {
    const { data, error } = await supabaseClient.rpc("rental_get_my_effective_permissions", {
      p_owner_id: effectiveOwnerId,
    });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Does the caller hold this new-framework key (owner/co-owner hold all)?
export async function hasRentalAdminKey({ supabaseClient, effectiveOwnerId, key }) {
  const keys = await getRentalAdminEffectiveKeys({ supabaseClient, effectiveOwnerId });
  return keys.includes(key);
}

export async function requireRentalAdminKey({ authenticated, key }) {
  const label = RENTAL_ADMIN_CAPABILITY_BY_KEY.get(key)?.label || key;
  const keys = await getRentalAdminEffectiveKeys({
    supabaseClient: authenticated.supabaseClient,
    effectiveOwnerId: authenticated.effectiveOwnerId,
  });
  if (!keys.includes(key)) {
    return {
      response: forbidden(`Your role does not allow this. Missing permission: ${label}.`),
      authorization: null,
    };
  }
  return { response: null, authorization: { effectiveKeys: keys } };
}

// Managing roles: owner, co-owner, or a staff admin holding
// rental.roles.manage (the RPC enforces the ceiling; this gate only checks
// the key).
export async function requireRentalRolesManager({ authenticated }) {
  return requireRentalAdminKey({ authenticated, key: "rental.roles.manage" });
}

// Reading roles / looking users up: owner, co-owner, or a staff admin
// holding rental.roles.read.
export async function requireRentalRolesRead({ authenticated }) {
  return requireRentalAdminKey({ authenticated, key: "rental.roles.read" });
}

// Reports gate (slice 1): allow when the caller holds the new-framework
// key OR has the existing workspace visibility (owner, co-owner, or any
// active member). The OR preserves current behavior for every existing
// user — no one loses report access in slice 1 — while the key is wired
// and enforced for callers who hold it. The underlying tables are not
// re-policied in slice 1, so the key alone does not yet grant data to a
// caller without visibility; that lands with the tables' migration.
export async function requireRentalReportAccess({ authenticated, key }) {
  const label = RENTAL_ADMIN_CAPABILITY_BY_KEY.get(key)?.label || key;
  const keys = await getRentalAdminEffectiveKeys({
    supabaseClient: authenticated.supabaseClient,
    effectiveOwnerId: authenticated.effectiveOwnerId,
  });
  if (keys.includes(key)) return { response: null };
  try {
    const { data: visible } = await authenticated.supabaseClient.rpc("has_workspace_visibility", {
      p_owner_id: authenticated.effectiveOwnerId,
    });
    if (visible === true) return { response: null };
  } catch {
    // A failed visibility check fails closed below (the key check above
    // already passed for key holders).
  }
  return {
    response: forbidden(`Your role does not allow this. Missing permission: ${label}.`),
  };
}

// Key-or-workspace-access gate (slice 1): allow when the caller holds the
// new-framework key OR has the existing workspace access (owner/co-owner).
// Used where a surface's existing behavior is owner/co-owner-gated and the
// new key adds staff access on top — e.g. the tenant invite action, whose
// stamp update is governed by the owner_all RLS policy today and by the
// edit-or-invite admin policy after slice 1. Checking BEFORE the action
// runs matters: it keeps a denied caller from triggering a side effect
// (like sending an email) that the later stamp update would then fail on.
export async function requireRentalAdminKeyOrWorkspaceAccess({ authenticated, key }) {
  const label = RENTAL_ADMIN_CAPABILITY_BY_KEY.get(key)?.label || key;
  const keys = await getRentalAdminEffectiveKeys({
    supabaseClient: authenticated.supabaseClient,
    effectiveOwnerId: authenticated.effectiveOwnerId,
  });
  if (keys.includes(key)) return { response: null };
  try {
    const { data: allowed } = await authenticated.supabaseClient.rpc("has_workspace_access", {
      p_owner_id: authenticated.effectiveOwnerId,
    });
    if (allowed === true) return { response: null };
  } catch {
    // A failed access check fails closed below.
  }
  return {
    response: forbidden(`Your role does not allow this. Missing permission: ${label}.`),
  };
}

// Map a PostgREST RPC error to an HTTP status + plain message. Stale
// versions are 409 (the caller re-reads and shows the fresh diff);
// permission errors are 403; everything else the RPC raised is a 400
// (bad input, duplicate, or a rule the RPC enforces).
export function rentalAdminRpcErrorResponse(error, fallbackMessage) {
  const message = error?.message || fallbackMessage || "Unable to complete that change.";
  const code = error?.code || "";
  if (code === "P0001" || /stale version/i.test(message)) {
    return NextResponse.json(
      { error: message, code: "stale_version" },
      { status: 409 },
    );
  }
  if (code === "42501" || /only the owner|does not allow this|cannot (assign|grant|change|edit|retire)/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}
