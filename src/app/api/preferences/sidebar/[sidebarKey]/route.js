import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only sidebars this app actually wires the customize control up for. A future Property sidebar
// reuses the same table/route shape by adding its own key here -- no new migration or route
// needed, just this allowlist entry plus passing sidebarKey to its own ApplicationShell.
const VALID_SIDEBAR_KEYS = new Set(["rental-manager", "financial"]);

async function requireUser(supabase) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) return { response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  return { user };
}

function requireValidKey(sidebarKey) {
  if (!VALID_SIDEBAR_KEYS.has(sidebarKey)) return NextResponse.json({ error: "Unknown sidebar." }, { status: 400 });
  return null;
}

export async function GET(_request, { params }) {
  const { sidebarKey } = await params;
  const invalidKeyResponse = requireValidKey(sidebarKey);
  if (invalidKeyResponse) return invalidKeyResponse;

  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const { data, error } = await supabase
    .from("user_sidebar_preferences")
    .select("hidden_item_ids")
    .eq("user_id", authed.user.id)
    .eq("sidebar_key", sidebarKey)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load your sidebar preferences." }, { status: 500 });

  return NextResponse.json({ success: true, hiddenItemIds: data?.hidden_item_ids ?? [] });
}

export async function PATCH(request, { params }) {
  const { sidebarKey } = await params;
  const invalidKeyResponse = requireValidKey(sidebarKey);
  if (invalidKeyResponse) return invalidKeyResponse;

  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const rawHiddenItemIds = body?.hiddenItemIds;
  if (!Array.isArray(rawHiddenItemIds) || !rawHiddenItemIds.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return NextResponse.json({ error: "hiddenItemIds must be an array of non-empty strings." }, { status: 400 });
  }
  // De-duplicate; order doesn't matter to a hide/show set.
  const hiddenItemIds = [...new Set(rawHiddenItemIds)];

  const { error } = await supabase
    .from("user_sidebar_preferences")
    .upsert(
      { user_id: authed.user.id, sidebar_key: sidebarKey, hidden_item_ids: hiddenItemIds, updated_at: new Date().toISOString() },
      { onConflict: "user_id,sidebar_key" },
    );
  if (error) return NextResponse.json({ error: "Unable to save your sidebar preferences." }, { status: 500 });

  return NextResponse.json({ success: true, hiddenItemIds });
}
