// GET /api/rental/admin/roles — list roles with capabilities + active
// assignee counts, the capability catalog, and the caller's own effective
// keys. Requires rental.roles.read (owner/co-owner hold every key).
// POST /api/rental/admin/roles — create a custom role.
// Body: { name, displayName, keys, requestId? }.
// PATCH /api/rental/admin/roles — edit a role's capabilities.
// Body: { roleId, addKeys, removeKeys, expectedVersion, requestId? }.
// A stale expectedVersion returns 409 with the fresh role list so the
// caller can show the fresh diff instead of overwriting someone else's edit.

import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import {
  RENTAL_ADMIN_CAPABILITIES,
  RENTAL_ADMIN_CAPABILITY_KEYS,
  RENTAL_ADMIN_OWNER_ONLY_KEYS,
  RENTAL_ADMIN_STARTER_ROLES,
  rentalAdminKeyLabels,
} from "@/lib/rental/adminPermissions";
import {
  getRentalAdminEffectiveKeys,
  rentalAdminRpcErrorResponse,
  requireRentalAdminKey,
  requireRentalRolesManager,
} from "@/lib/rental/adminRoleAuthorization";

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalAdminKey({ authenticated, key: "rental.roles.read" });
    if (gate.response) return gate.response;

    const { data, error } = await authenticated.supabaseClient.rpc("rental_list_roles", {
      p_owner_id: authenticated.effectiveOwnerId,
    });
    if (error) return NextResponse.json({ error: error.message || "Unable to load roles." }, { status: 500 });

    return NextResponse.json({
      success: true,
      roles: data || [],
      catalog: RENTAL_ADMIN_CAPABILITIES,
      starterRoles: RENTAL_ADMIN_STARTER_ROLES,
      ownerOnlyKeys: RENTAL_ADMIN_OWNER_ONLY_KEYS,
      myEffectiveKeys: gate.authorization.effectiveKeys,
      viewerId: authenticated.user.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to load roles." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalRolesManager({ authenticated });
    if (gate.response) return gate.response;

    const body = await request.json();
    const name = String(body?.name || "").trim();
    const displayName = String(body?.displayName || "").trim();
    const keys = Array.isArray(body?.keys) ? body.keys.map((k) => String(k)) : [];
    if (!name) return NextResponse.json({ error: "A role name is required." }, { status: 400 });
    if (!displayName) return NextResponse.json({ error: "A display name is required." }, { status: 400 });
    const unknown = keys.filter((k) => !RENTAL_ADMIN_CAPABILITY_KEYS.includes(k));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown permission: ${unknown.join(", ")}.` }, { status: 400 });
    }

    const { data, error } = await authenticated.supabaseClient.rpc("rental_create_role", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_name: name,
      p_display_name: displayName,
      p_keys: keys,
      p_request_id: String(body?.requestId || newRequestId()),
    });
    if (error) return rentalAdminRpcErrorResponse(error, "Unable to create that role.");

    const role = data?.role || null;
    const added = rentalAdminKeyLabels(keys);
    return NextResponse.json({
      success: true,
      role,
      message: added.length > 0
        ? `Created the ${displayName} role with ${added.join(", ")}.`
        : `Created the ${displayName} role with no permissions.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to create that role." },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalRolesManager({ authenticated });
    if (gate.response) return gate.response;

    const body = await request.json();
    const roleId = String(body?.roleId || "").trim();
    const addKeys = Array.isArray(body?.addKeys) ? body.addKeys.map((k) => String(k)) : [];
    const removeKeys = Array.isArray(body?.removeKeys) ? body.removeKeys.map((k) => String(k)) : [];
    const expectedVersion = Number(body?.expectedVersion);
    if (!roleId) return NextResponse.json({ error: "A role id is required." }, { status: 400 });
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ error: "A valid expected version is required." }, { status: 400 });
    }
    const unknown = [...addKeys, ...removeKeys].filter((k) => !RENTAL_ADMIN_CAPABILITY_KEYS.includes(k));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown permission: ${unknown.join(", ")}.` }, { status: 400 });
    }

    const { data, error } = await authenticated.supabaseClient.rpc("rental_update_role", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_role_id: roleId,
      p_add_keys: addKeys,
      p_remove_keys: removeKeys,
      p_expected_version: expectedVersion,
      p_request_id: String(body?.requestId || newRequestId()),
    });
    if (error) {
      // Stale version: send the fresh role list so the caller can show the
      // fresh diff instead of silently overwriting someone else's edit.
      if (error.code === "P0001" || /stale version/i.test(error.message || "")) {
        const fresh = await authenticated.supabaseClient.rpc("rental_list_roles", {
          p_owner_id: authenticated.effectiveOwnerId,
        });
        return NextResponse.json(
          {
            error: error.message || "This role was changed by someone else. Reload and try again.",
            code: "stale_version",
            roles: fresh.data || [],
          },
          { status: 409 },
        );
      }
      return rentalAdminRpcErrorResponse(error, "Unable to update that role.");
    }

    const added = rentalAdminKeyLabels(data?.added || []);
    const removed = rentalAdminKeyLabels(data?.removed || []);
    const affected = Number(data?.affected_user_count || 0);
    const displayName = data?.role?.display_name || "the role";
    const parts = [];
    if (added.length > 0) parts.push(`added ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
    return NextResponse.json({
      success: true,
      role: data?.role || null,
      affectedUserCount: affected,
      added: data?.added || [],
      removed: data?.removed || [],
      version: data?.version,
      message: parts.length > 0
        ? `Saved the ${displayName} role: ${parts.join("; ")}. This changes access for ${affected} staff member${affected === 1 ? "" : "s"}.`
        : `Saved the ${displayName} role. Nothing changed.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to update that role." },
      { status: 500 },
    );
  }
}
