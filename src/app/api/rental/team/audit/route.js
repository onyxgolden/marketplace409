import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";

// GET /api/rental/team/audit -- recent team-management and preview audit entries.
// Owner/co-owner (team.manage) only.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({ authenticated, request });
    if (gate.response) return gate.response;

    const { data, error } = await authenticated.supabaseClient.rpc("get_team_audit_log", { p_limit: 100 });
    if (error) return NextResponse.json({ error: "Unable to load the audit log." }, { status: 500 });

    return NextResponse.json({
      success: true,
      entries: (data || []).map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actor_user_id,
        targetMemberId: row.target_member_id,
        detail: row.detail || {},
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to load the audit log." },
      { status: 500 }
    );
  }
}
