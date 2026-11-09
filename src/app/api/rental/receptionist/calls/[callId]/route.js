import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { decryptCallbackE164 } from "@/lib/receptionist/callbackCrypto";

// GET /api/rental/receptionist/calls/[callId] — call detail: slots with
// provenance, event timeline, alert timeline + provider receipts, drafts.
// Owner-scoped: a cross-workspace call id 404s (no existence information).
// The callback number is stored as AES-256-GCM ciphertext and decrypted
// server-side for the authenticated owner only; the ciphertext value
// never leaves the server.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { callId } = await params;
    const { data: call, error } = await supabaseClient
      .from("forge_rental_receptionist_calls")
      .select("*")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", callId)
      .maybeSingle();
    if (error) throw error;
    if (!call) return NextResponse.json({ error: "Call was not found." }, { status: 404 });

    // Decrypt for the owner read path only. A key that can no longer
    // decrypt the stored value is surfaced honestly instead of leaking
    // ciphertext or failing the whole detail view.
    let callbackUnavailable = false;
    let callbackE164 = null;
    try {
      callbackE164 = decryptCallbackE164(call.callback_e164_encrypted);
    } catch (decryptError) {
      console.error("Receptionist callback decrypt error", decryptError);
      callbackUnavailable = Boolean(call.callback_e164_encrypted);
    }
    const shapedCall = { ...call, callback_e164: callbackE164, callback_unavailable: callbackUnavailable };
    delete shapedCall.callback_e164_encrypted;

    const [{ data: events }, { data: drafts }, { data: alerts }] = await Promise.all([
      supabaseClient.from("forge_rental_receptionist_events").select("event_id, event_type, occurred_at, source_turn_id, policy_version").eq("owner_id", effectiveOwnerId).eq("call_id", call.id).order("occurred_at", { ascending: true }),
      supabaseClient.from("forge_rental_receptionist_drafts").select("id, draft_kind, proposed_payload, review_state, reviewed_at, review_reason, version").eq("owner_id", effectiveOwnerId).eq("call_id", call.id),
      call.emergency_event_id
        ? supabaseClient.from("forge_rental_receptionist_alerts").select("*").eq("owner_id", effectiveOwnerId).eq("emergency_event_id", call.emergency_event_id)
        : { data: [] },
    ]);
    let attempts = [];
    if (call.emergency_event_id) {
      const { data } = await supabaseClient.from("forge_rental_receptionist_alert_attempts")
        .select("target_role, channel, attempt_no, state, provider_sid, failure_class, requested_at, provider_accepted_at, delivered_at")
        .eq("owner_id", effectiveOwnerId).eq("emergency_event_id", call.emergency_event_id)
        .order("requested_at", { ascending: true });
      attempts = data || [];
    }
    return NextResponse.json({ success: true, call: shapedCall, events: events || [], drafts: drafts || [], alerts: alerts || [], alertAttempts: attempts });
  } catch (error) {
    console.error("Receptionist call detail error", error);
    return NextResponse.json({ error: "Unable to load the call." }, { status: 500 });
  }
}
