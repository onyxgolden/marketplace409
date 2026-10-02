import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { summarizeBatchLetters } from "@/domains/rental-mailing/mailingLetters";

export const runtime = "nodejs";

// Rentec parity R20 — one batch with its letters and per-status counts.
// Readable by every workspace member; reading the queue is not a write.

const LETTER_COLUMNS = "id, batch_id, template_id, tenant_id, tenant_name, recipient_address, return_address, subject, body, letter_date, status, tracking_number, mailed_at, delivered_at, document_id, created_at";

function rowToLetter(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    templateId: row.template_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    recipientAddress: row.recipient_address,
    returnAddress: row.return_address,
    subject: row.subject,
    body: row.body,
    letterDate: row.letter_date,
    status: row.status,
    trackingNumber: row.tracking_number,
    mailedAt: row.mailed_at,
    deliveredAt: row.delivered_at,
    documentId: row.document_id,
    createdAt: row.created_at,
  };
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { data: batch, error: batchError } = await supabaseClient
      .from("rental_mail_batches")
      .select("id, name, created_by, created_at, updated_at")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .maybeSingle();
    if (batchError) throw batchError;
    if (!batch) return NextResponse.json({ error: "The mailing batch was not found." }, { status: 404 });
    const { data: letters, error: letterError } = await supabaseClient
      .from("rental_mail_letters")
      .select(LETTER_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("batch_id", batch.id)
      .order("created_at", { ascending: true });
    if (letterError) throw letterError;
    const mapped = (letters || []).map(rowToLetter);
    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        name: batch.name,
        createdAt: batch.created_at,
        summary: summarizeBatchLetters(mapped),
        letters: mapped,
      },
    });
  } catch (error) {
    console.error("Mailing batch load error", error);
    return NextResponse.json({ error: "Unable to load the mailing batch." }, { status: 500 });
  }
}
