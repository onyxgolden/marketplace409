import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActorRentalAuthorization, requireTeamManager } from "@/lib/rental/teamAuthorization";
import { RENTAL_PERMISSIONS, roleLabel } from "@/lib/rental/permissions";

// GET /api/rental/team/permissions -- the actor's effective permission set (the preview
// target's set while previewing). Any authenticated workspace actor may read their own.
// The UI uses this to hide actions the actor cannot perform; the API layer re-checks
// server-side on every mutation, so this is a convenience, not a security boundary.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    const authorization = await getActorRentalAuthorization({
      supabaseClient: authenticated.supabaseClient,
      actorUserId: authenticated.user.id,
      effectiveOwnerId: authenticated.effectiveOwnerId,
      request,
    });
    if (authorization.forbidden) return authorization.forbidden;

    return NextResponse.json({
      success: true,
      role: authorization.role,
      roleLabel: roleLabel(authorization.role),
      isPrimaryOwner: authorization.isPrimaryOwner,
      permissions: authorization.permissions,
      permissionCatalog: RENTAL_PERMISSIONS,
      preview: authorization.preview
        ? {
            memberId: authorization.preview.memberId,
            role: authorization.preview.role,
            roleLabel: roleLabel(authorization.preview.role),
            email: authorization.preview.email,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to resolve permissions." },
      { status: 500 }
    );
  }
}
