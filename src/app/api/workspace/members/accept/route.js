import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Deliberately takes no body -- accept_workspace_invitation() derives everything from auth.uid()
// server-side. This route never accepts or forwards a client-submitted user id (requirement 10).
export async function POST() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const { data, error } = await authenticated.supabaseClient.rpc("accept_workspace_invitation");
  if (error) return NextResponse.json({ error: error.message || "Unable to accept that invitation." }, { status: 400 });

  return NextResponse.json({
    success: true,
    member: {
      id: data.id,
      role: data.role,
      status: data.status,
      activatedAt: data.activated_at,
    },
  });
}
