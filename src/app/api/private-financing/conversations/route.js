import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";

// unread: the borrower sent the most recent message and the owner hasn't read past it yet -- never
// derived from borrower_last_read_at, which says nothing about what the OWNER has seen.
export async function GET() {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  const conversationsResult = await authenticated.supabaseClient.from("private_financing_conversations")
    .select("id, borrower_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at")
    .order("last_message_at", { ascending: false });
  if (conversationsResult.error) return NextResponse.json({ error: "Unable to load conversations." }, { status: 500 });

  const rows = conversationsResult.data || [];
  const borrowerIds = [...new Set(rows.map((row) => row.borrower_id))];
  let borrowersById = new Map();
  if (borrowerIds.length > 0) {
    const borrowersResult = await authenticated.supabaseClient.from("private_financing_borrowers")
      .select("id, full_name, email").in("id", borrowerIds);
    if (borrowersResult.error) return NextResponse.json({ error: "Unable to load conversations." }, { status: 500 });
    borrowersById = new Map((borrowersResult.data || []).map((row) => [row.id, row]));
  }

  return NextResponse.json({
    success: true,
    conversations: rows.map((row) => ({
      id: row.id,
      borrowerId: row.borrower_id,
      borrowerName: borrowersById.get(row.borrower_id)?.full_name || borrowersById.get(row.borrower_id)?.email || row.borrower_id,
      lastMessageAt: row.last_message_at,
      lastMessageBody: row.last_message_body,
      lastMessageSenderType: row.last_message_sender_type,
      unread: row.last_message_sender_type === "borrower" && (!row.owner_last_read_at || row.owner_last_read_at < row.last_message_at),
    })),
  });
}
