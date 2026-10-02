import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import {
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_COOKIE_NAME,
  getActorRentalAuthorization,
  requireTeamManager,
} from "@/lib/rental/teamAuthorization";
import { roleLabel } from "@/lib/rental/permissions";

function previewCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: PREVIEW_COOKIE_MAX_AGE_SECONDS,
    ...(process.env.NODE_ENV === "production" ? { secure: true } : {}),
  };
}

// GET /api/rental/team/preview -- current preview session state (for the banner + UI hiding).
// Any authenticated workspace actor may read their own session.
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
    if (authorization.forbidden) {
      // An invalid preview cookie fails closed: report it so the UI can offer to end it.
      return NextResponse.json({ success: true, preview: null, previewInvalid: true });
    }

    return NextResponse.json({
      success: true,
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
      { error: error?.message || "Unable to read the preview session." },
      { status: 500 }
    );
  }
}

// POST /api/rental/team/preview -- start a read-only "view as" session for a team member.
// Body: { memberId }. Owner/co-owner only. Audited. The target must be an active staff
// member of the same workspace -- never a co-owner, never yourself.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({ authenticated, request });
    if (gate.response) return gate.response;

    const body = await request.json();
    const memberId = String(body?.memberId || "").trim();
    if (!memberId) return NextResponse.json({ error: "A member id is required." }, { status: 400 });

    const { data: target, error: targetError } = await authenticated.supabaseClient
      .from("workspace_members")
      .select("id, role, status, invited_email, member_user_id")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", memberId)
      .maybeSingle();
    if (targetError) return NextResponse.json({ error: "Unable to verify that team member." }, { status: 500 });
    if (!target || target.status !== "active") {
      return NextResponse.json({ error: "That team member is not active." }, { status: 400 });
    }
    if (target.role === "co_owner" || target.member_user_id === authenticated.user.id) {
      return NextResponse.json({ error: "You can only preview as an active staff member." }, { status: 400 });
    }

    await authenticated.supabaseClient.rpc("log_team_audit", {
      p_action: "preview.start",
      p_target_member_id: target.id,
      p_detail: { role: target.role, email: target.invited_email },
    });

    const response = NextResponse.json({
      success: true,
      preview: {
        memberId: target.id,
        role: target.role,
        roleLabel: roleLabel(target.role),
        email: target.invited_email,
      },
    });
    response.cookies.set(PREVIEW_COOKIE_NAME, encodeURIComponent(target.id), previewCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to start the preview session." },
      { status: 500 }
    );
  }
}

// DELETE /api/rental/team/preview -- end the preview session. Audited.
export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    const authorization = await getActorRentalAuthorization({
      supabaseClient: authenticated.supabaseClient,
      actorUserId: authenticated.user.id,
      effectiveOwnerId: authenticated.effectiveOwnerId,
      request,
    });
    const endedPreview = authorization.preview || null;

    if (endedPreview) {
      await authenticated.supabaseClient.rpc("log_team_audit", {
        p_action: "preview.end",
        p_target_member_id: endedPreview.memberId,
        p_detail: { role: endedPreview.role },
      });
    }

    const response = NextResponse.json({ success: true, endedPreview: Boolean(endedPreview) });
    response.cookies.delete(PREVIEW_COOKIE_NAME);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to end the preview session." },
      { status: 500 }
    );
  }
}
