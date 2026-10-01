import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isValidReceiptId } from "@/application/rental/receipts";
import { extractReceiptData, EXTRACTION_STATUS } from "@/application/rental/receiptExtraction";

// POST /api/rental/receipts/[id]/extract — the "Scan with AI" button.
// HARD-GATED: the only provider is the "not connected" stub. This route
// performs zero network calls for extraction and says so honestly, so the
// UI can never present a dead button. See docs/rentec-parity/AI_SCAN_GATE.md.
export async function POST(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) {
      return NextResponse.json({ error: "A valid receipt is required." }, { status: 400 });
    }
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const { data: receipt, error: receiptError } = await supabaseClient
      .from("rental_receipts")
      .select("id, document_id, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId)
      .maybeSingle();
    if (receiptError) throw receiptError;
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

    // The stub: always not_connected. When a gated provider is connected in
    // the future, it receives the receipt file bytes here — today nothing is
    // fetched and nothing is sent anywhere.
    const result = await extractReceiptData({ receiptId, fileBytes: null, mimeType: null });

    const { error: updateError } = await supabaseClient
      .from("rental_receipts")
      .update({ extraction_status: result.status })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: result.status !== EXTRACTION_STATUS.FAILED,
      extraction: result,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to scan the receipt." }, { status: 500 });
  }
}
