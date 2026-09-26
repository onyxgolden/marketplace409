import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  FINANCIAL_KPI_CARD_IDS,
  FINANCIAL_SECTION_CARD_IDS,
} from "@/components/forge/financial/dashboardCardLayout.js";

// Dashboard zones whose card arrangement syncs across the signed-in user's
// devices. The layout_key doubles as the zone identifier; a future dashboard
// reuses the same table/route shape by adding its own key here -- no new
// migration needed, just this allowlist entry.
const VALID_LAYOUT_KEYS = new Set(["financial-sections", "financial-kpis"]);

const LAYOUT_CARD_IDS = {
  "financial-sections": new Set(FINANCIAL_SECTION_CARD_IDS),
  "financial-kpis": new Set(FINANCIAL_KPI_CARD_IDS),
};

async function requireUser(supabase) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) return { response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  return { user };
}

function requireValidKey(layoutKey) {
  if (!VALID_LAYOUT_KEYS.has(layoutKey)) return NextResponse.json({ error: "Unknown dashboard layout." }, { status: 400 });
  return null;
}

// A layout is { order: [cardId, ...], hidden: [cardId, ...] }. `order` holds
// every card (hidden cards keep their slots so un-hiding restores position);
// `hidden` is the subset currently hidden. Every id must belong to the
// zone's registry, appear at most once per list, and hidden must be a subset
// of order -- unknown or dropped ids would silently lose cards on another
// device, so the server rejects them instead of letting a stale client
// corrupt the shared layout.
function sanitizeLayout(layoutKey, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "layout must be an object with order and hidden arrays." };
  const { order, hidden } = raw;
  if (!Array.isArray(order) || !Array.isArray(hidden)) return { error: "layout must be an object with order and hidden arrays." };
  const known = LAYOUT_CARD_IDS[layoutKey];
  for (const [name, list] of [["order", order], ["hidden", hidden]]) {
    const seen = new Set();
    for (const id of list) {
      if (typeof id !== "string" || !known.has(id)) return { error: `Unknown card id: ${String(id)}.` };
      if (seen.has(id)) return { error: `Duplicate card id in ${name}: ${id}.` };
      seen.add(id);
    }
  }
  if (order.length !== known.size) return { error: "order must contain every card in the zone exactly once." };
  for (const id of known) {
    if (!order.includes(id)) return { error: `order is missing card id: ${id}.` };
  }
  for (const id of hidden) {
    if (!order.includes(id)) return { error: `hidden card id not in order: ${id}.` };
  }
  return { layout: { order: [...order], hidden: [...hidden] } };
}

export async function GET(_request, { params }) {
  const { layoutKey } = await params;
  const invalidKeyResponse = requireValidKey(layoutKey);
  if (invalidKeyResponse) return invalidKeyResponse;

  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const { data, error } = await supabase
    .from("user_dashboard_layouts")
    .select("layout, updated_at")
    .eq("user_id", authed.user.id)
    .eq("layout_key", layoutKey)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load your dashboard layout." }, { status: 500 });

  return NextResponse.json({
    success: true,
    layout: data?.layout ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PUT(request, { params }) {
  const { layoutKey } = await params;
  const invalidKeyResponse = requireValidKey(layoutKey);
  if (invalidKeyResponse) return invalidKeyResponse;

  const supabase = await createClient();
  const authed = await requireUser(supabase);
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const { layout, error: layoutError } = sanitizeLayout(layoutKey, body?.layout);
  if (layoutError) return NextResponse.json({ error: layoutError }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from("user_dashboard_layouts")
    .upsert(
      { user_id: authed.user.id, layout_key: layoutKey, layout, updated_at: updatedAt },
      { onConflict: "user_id,layout_key" },
    );
  if (error) return NextResponse.json({ error: "Unable to save your dashboard layout." }, { status: 500 });

  return NextResponse.json({ success: true, layout, updatedAt });
}
