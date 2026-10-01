import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

// R23 — link an owner recipient to the properties whose gross rent counts
// toward their 1099-MISC Box 1.
// POST /api/rental/1099/recipients/[id]/properties { propertyId }
// DELETE /api/rental/1099/recipients/[id]/properties?propertyId=...
// Writer role (read-only members get 403). Linking is what attributes gross
// rent from the ledger to the recipient — without links, Box 1 is $0.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot link 1099 properties." }, { status: 403 });
  }
  return null;
}

export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { data, error } = await supabaseClient
      .from("rental_1099_recipient_properties")
      .select("property_id, created_at")
      .eq("owner_id", effectiveOwnerId)
      .eq("recipient_id", (await params).id)
      .order("created_at");
    if (error) throw error;
    return NextResponse.json({ success: true, propertyIds: (data || []).map((row) => row.property_id) });
  } catch {
    return NextResponse.json({ error: "Unable to load linked properties." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const recipientId = (await params).id;
    const body = await request.json().catch(() => ({}));
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId.trim() : "";
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required." }, { status: 400 });
    }
    const { data: recipient, error: recipientError } = await supabaseClient
      .from("rental_1099_recipients")
      .select("id, kind")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", recipientId)
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (!recipient) return NextResponse.json({ error: "Recipient was not found." }, { status: 404 });
    if (recipient.kind !== "owner") {
      return NextResponse.json({ error: "Only owner recipients link properties for gross-rent attribution." }, { status: 400 });
    }
    const { error: insertError } = await supabaseClient
      .from("rental_1099_recipient_properties")
      .upsert(
        { owner_id: effectiveOwnerId, recipient_id: recipientId, property_id: propertyId },
        { onConflict: "owner_id,recipient_id,property_id", ignoreDuplicates: true }
      );
    if (insertError) throw insertError;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to link the property." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const url = new URL(request.url);
    const propertyId = url.searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required." }, { status: 400 });
    }
    const { error } = await supabaseClient
      .from("rental_1099_recipient_properties")
      .delete()
      .eq("owner_id", effectiveOwnerId)
      .eq("recipient_id", (await params).id)
      .eq("property_id", propertyId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to unlink the property." }, { status: 500 });
  }
}
