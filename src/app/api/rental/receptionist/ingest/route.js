import { NextResponse } from "next/server";
import { createReceptionistIngestClient } from "@/lib/receptionist/createReceptionistIngestClient";
import { resolveOperationOwner, verifyIngestSignature } from "@/lib/receptionist/ingestAuth";

// POST /api/rental/receptionist/ingest — voice worker -> FORGE.
// HMAC-signed (X-Forge-Signature/Timestamp/Nonce), replay-protected,
// idempotent on provider_call_sid + ingest_idempotency_key. Creates ONLY
// draft records (PENDING review); no canonical lead / work order /
// tenant mutation happens here. No browser/client direct writes to these
// tables. Operation -> owner mapping comes from server env, never the body.
export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-forge-signature") || "";
    const timestamp = request.headers.get("x-forge-timestamp") || "";
    const nonce = request.headers.get("x-forge-nonce") || "";
    const secret = process.env.RECEPTIONIST_FORGE_INGEST_SECRET || "";
    if (!verifyIngestSignature({ secret, rawBody, timestamp, nonce, signature })) {
      return NextResponse.json({ error: "Invalid ingestion signature." }, { status: 401 });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const ownerId = resolveOperationOwner(payload?.operation_id);
    if (!ownerId) return NextResponse.json({ error: "Invalid ingestion signature." }, { status: 401 });
    if (typeof payload?.provider_call_sid !== "string" || !payload.provider_call_sid) {
      return NextResponse.json({ error: "provider_call_sid is required." }, { status: 400 });
    }
    if (typeof payload?.policy_version !== "string" || !payload.policy_version) {
      return NextResponse.json({ error: "policy_version is required." }, { status: 400 });
    }

    const supabase = createReceptionistIngestClient();
    const callRow = {
      owner_id: ownerId,
      operation_id: payload.operation_id,
      provider_call_sid: payload.provider_call_sid,
      started_at: payload.started_at ? new Date(payload.started_at * 1000).toISOString() : undefined,
      ended_at: payload.ended_at ? new Date(payload.ended_at * 1000).toISOString() : undefined,
      direction: "INBOUND",
      intent: payload.intent || null,
      caller_ani_masked: payload.caller_ani_masked || null,
      name_claimed: payload.name_claimed || null,
      need_excerpt: payload.need_excerpt || null,
      // Encrypted at rest by the database layer; the worker sends the
      // validated slot value over TLS only.
      callback_e164_encrypted: payload.callback_e164 || null,
      callback_confirmed: Boolean(payload.callback_confirmed),
      callback_source: payload.callback_source || null,
      property_hint: payload.property_hint || null,
      match_status: "REVIEW_REQUIRED",
      emergency_event_id: payload.emergency_event_id || null,
      consent_status: payload.consent_status || null,
      processing_state: payload.processing_state || "IN_PROGRESS",
      policy_version: payload.policy_version,
    };
    const { data: call, error: callError } = await supabase
      .from("forge_rental_receptionist_calls")
      .upsert(callRow, { onConflict: "owner_id,provider_call_sid" })
      .select("id")
      .single();
    if (callError) throw callError;

    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events) {
      if (!event?.event_id || !event?.event_type || !event?.ingest_idempotency_key) continue;
      const { error } = await supabase.from("forge_rental_receptionist_events").insert({
        call_id: call.id,
        owner_id: ownerId,
        event_id: event.event_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at ? new Date(event.occurred_at * 1000).toISOString() : undefined,
        payload_minimal: event.payload || {},
        source_turn_id: event.turn_id || null,
        policy_version: event.policy_version || payload.policy_version,
        ingest_idempotency_key: event.ingest_idempotency_key,
      });
      // Duplicate/out-of-order provider events are idempotent: ignore
      // unique-violation retries, surface anything else.
      if (error && error.code !== "23505") throw error;
    }

    let draftId = null;
    if (payload.draft_kind) {
      const { data: draft, error: draftError } = await supabase
        .from("forge_rental_receptionist_drafts")
        .insert({
          owner_id: ownerId,
          call_id: call.id,
          draft_kind: payload.draft_kind,
          proposed_payload: {
            name_claimed: payload.name_claimed || null,
            need_excerpt: payload.need_excerpt || null,
            callback_confirmed: Boolean(payload.callback_confirmed),
            property_hint: payload.property_hint || null,
            emergency_type: payload.emergency_type || null,
          },
          review_state: "PENDING",
        })
        .select("id")
        .single();
      if (draftError && draftError.code !== "23505") throw draftError;
      draftId = draft?.id || null;
      if (draftId) {
        await supabase.from("forge_rental_receptionist_calls")
          .update({ maintenance_draft_id: draftId }).eq("id", call.id).eq("owner_id", ownerId);
      }
    }

    return NextResponse.json({ success: true, callId: call.id, draftId });
  } catch (error) {
    console.error("Receptionist ingest error", error);
    return NextResponse.json({ error: "Unable to ingest the call record." }, { status: 500 });
  }
}
