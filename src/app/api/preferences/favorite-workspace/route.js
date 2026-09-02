import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_WORKSPACE_IDS = new Set(["marketplace", "rentals", "forge", "scheduling", "dev", "health"]);

async function requireUser(supabase) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) return { response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  return { user };
}

export async function GET() {
  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const { data, error } = await supabase
    .from("user_workspace_preferences")
    .select("favorite_workspace_id")
    .eq("user_id", authed.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load your favorite workspace." }, { status: 500 });

  return NextResponse.json({ success: true, favoriteWorkspaceId: data?.favorite_workspace_id ?? null });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  // null clears the favorite -- back to always showing the workspace picker.
  const favoriteWorkspaceId = body?.favoriteWorkspaceId === null ? null : String(body?.favoriteWorkspaceId || "").trim();
  if (favoriteWorkspaceId !== null && !VALID_WORKSPACE_IDS.has(favoriteWorkspaceId)) {
    return NextResponse.json({ error: "Unknown workspace." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_workspace_preferences")
    .upsert({ user_id: authed.user.id, favorite_workspace_id: favoriteWorkspaceId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "Unable to save your favorite workspace." }, { status: 500 });

  return NextResponse.json({ success: true, favoriteWorkspaceId });
}
