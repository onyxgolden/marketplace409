import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

function rowToMessage(row) {
  return { id: row.id, senderType: row.sender_type, body: row.body, category: row.category, createdAt: row.created_at };
}

// Opening this thread IS the owner's read action -- there is no separate "mark read" click in the
// owner UI, matching how an inbox naturally works. mark_rental_conversation_read_by_owner is a no-op
// (updates zero rows) when no conversation exists yet for this tenant, so this is safe to call even
// before any message has ever been sent.
export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const { tenantId } = await params;
  const conversation = await authenticated.supabaseClient.from("rental_conversations")
    .select("id").eq("tenant_id", tenantId).maybeSingle();
  if (conversation.error) return NextResponse.json({ error: "Unable to load this conversation." }, { status: 500 });
  if (!conversation.data) return NextResponse.json({ success: true, messages: [] });
  const { data, error } = await authenticated.supabaseClient.from("rental_conversation_messages")
    .select("id, sender_type, body, category, created_at").eq("conversation_id", conversation.data.id)
    .order("created_at", { ascending: true }).limit(500);
  if (error) return NextResponse.json({ error: "Unable to load this conversation." }, { status: 500 });
  const { error: readError } = await authenticated.supabaseClient.rpc("mark_rental_conversation_read_by_owner", { p_tenant_id: tenantId });
  if (readError) return NextResponse.json({ error: "Unable to mark this conversation as read." }, { status: 500 });
  return NextResponse.json({ success: true, messages: (data || []).map(rowToMessage) });
}

export async function POST(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const { tenantId } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.body !== "string" || body.body.trim() === "")
    return NextResponse.json({ error: "A message body is required." }, { status: 400 });
  const { data, error } = await authenticated.supabaseClient.rpc("send_rental_conversation_owner_message", {
    p_tenant_id: tenantId, p_body: body.body.trim(),
  });
  if (error) return NextResponse.json({ error: "Unable to send this message." }, { status: 500 });
  return NextResponse.json({ success: true, message: data });
}
