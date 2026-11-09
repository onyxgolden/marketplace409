import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createReceptionistIngestClient } from "@/lib/receptionist/createReceptionistIngestClient";
import { encryptCallbackE164 } from "@/lib/receptionist/callbackCrypto";
import { resolveOperationOwner, verifyIngestSignature } from "@/lib/receptionist/ingestAuth";

// POST /api/rental/receptionist/ingest — voice worker -> FORGE.
// HMAC-signed (X-Forge-Signature/Timestamp/Nonce), replay-protected,
// idempotent on provider_call_sid + ingest_idempotency_key. Creates ONLY
// draft records (PENDING review); no canonical lead / work order /
// tenant mutation happens here. No browser/client direct writes to these
// tables. Operation -> owner mapping comes from server env, never the body.
//
// Replay safety (P2-1; lifecycle fix round 2, P1-2; lease tokens fix
// round 3, P1-1): the signed nonce is CLAIMED by
// receptionist_claim_ingest_nonce before any write, but claiming does
// not mark the delivery complete. The claim is an EXCLUSIVE 60-second
// lease: the claimant gets a lease_token, and only that token may
// complete or fail the claim. A concurrent duplicate while the lease
// is live gets 'busy' and must NOT run the ingest — this route returns
// an honest in-progress 409 instead of running the writes twice. An
// expired lease is taken over with fencing: the old token can no longer
// complete or fail. The nonce carries IN_PROGRESS -> COMMITTED |
// FAILED: only receptionist_complete_ingest_nonce commits it, after
// every ingest write lands, and only by the lease token. If any write
// fails, the nonce is marked FAILED by its token holder, so an
// identical retry re-runs the ingest instead of being told it is
// already a duplicate. A committed replay returns the stored original
// result; the same nonce with a different request hash is rejected
// (409). The writes themselves are idempotent (call upsert, event
// dedupe, draft upsert), so a retry after failure collapses onto the
// same records.
// Completion honesty (fix round 3, P1-2): the completion RPC returns a
// boolean — the route checks it. An RPC error or a false return means
// the commit is unconfirmed, so the route releases the claim (fenced
// by its token) and returns a retryable 503, never success:true.
// Callback privacy (P1-6): the callback number is AES-256-GCM encrypted
// before insert; a missing encryption key fails the request closed
// instead of storing plaintext.
// Draft linking (fix round 2, P1-3): the draft upsert uses
// ON CONFLICT DO NOTHING, which returns zero rows on the conflict
// path — so the route reads the id back with an owner-scoped SELECT
// instead of .single(), which 500s on zero rows. First insert wins:
// a replay never resets an already-reviewed draft.
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
    // Go-live: source labels every call TEST | LIVE | SYNTHETIC so test
    // traffic can never be mistaken for live traffic in the inbox.
    // Absent (v1 payloads) defaults to SYNTHETIC; anything else 400s.
    const source = payload?.source ?? "SYNTHETIC";
    if (!["TEST", "LIVE", "SYNTHETIC"].includes(source)) {
      return NextResponse.json({ error: "source must be TEST, LIVE, or SYNTHETIC." }, { status: 400 });
    }
    // Per-call cost estimate (USD, from the worker's versioned rate
    // table). A non-number or negative value 400s — a bad cost must
    // never land silently on the call row.
    let costEstimateUsd = null;
    if (payload?.cost_estimate_usd !== undefined && payload?.cost_estimate_usd !== null) {
      if (typeof payload.cost_estimate_usd !== "number" || payload.cost_estimate_usd < 0) {
        return NextResponse.json({ error: "cost_estimate_usd must be a non-negative number." }, { status: 400 });
      }
      costEstimateUsd = payload.cost_estimate_usd;
    }
    const costRateVersion = typeof payload?.cost_rate_version === "string" ? payload.cost_rate_version : null;

    const supabase = createReceptionistIngestClient();
    // Claim the nonce (fresh / busy / retry / committed / hash_mismatch).
    // A claim is not a completion: only complete_ingest_nonce, called
    // after every write below and only by the lease token this claim
    // returns, commits the delivery.
    const requestHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    const { data: claim, error: claimError } = await supabase.rpc(
      "receptionist_claim_ingest_nonce",
      { p_owner_id: ownerId, p_nonce: nonce, p_request_hash: requestHash },
    );
    if (claimError) throw claimError;
    if (claim?.status === "hash_mismatch") {
      return NextResponse.json(
        { error: "Nonce already used with a different request." }, { status: 409 });
    }
    if (claim?.status === "busy") {
      // Another worker owns the live lease for this nonce: do NOT run
      // the writes. The caller retries; once the lease expires or the
      // owner fails, the retry takes the claim over.
      return NextResponse.json(
        { error: "Ingest already in progress for this nonce; retry the delivery." },
        { status: 409 });
    }
    if (claim?.status === "committed") {
      // Stable original result: the delivery already landed.
      return NextResponse.json(
        claim.result ?? { success: true, callId: claim.call_id ?? null, draftId: null });
    }
    // The lease token this claim owns. Only this token may complete or
    // fail the claim — a stale token changes nothing (fencing).
    const leaseToken = claim?.lease_token ?? null;

    // fresh or retry: run the ingest. Any failure below marks the
    // nonce FAILED so an identical retry re-runs the writes.
    try {
      let callbackEncrypted = null;
      if (typeof payload.callback_e164 === "string" && payload.callback_e164) {
        // Fail closed: without a configured key there is no honest way to
        // store this column, so the ingest fails instead of writing plaintext.
        callbackEncrypted = encryptCallbackE164(payload.callback_e164);
      }
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
        callback_e164_encrypted: callbackEncrypted,
        callback_confirmed: Boolean(payload.callback_confirmed),
        callback_source: payload.callback_source || null,
        property_hint: payload.property_hint || null,
        match_status: "REVIEW_REQUIRED",
        emergency_event_id: payload.emergency_event_id || null,
        consent_status: payload.consent_status || null,
        source,
        cost_estimate_usd: costEstimateUsd,
        cost_rate_version: costRateVersion,
        processing_state: payload.processing_state || "IN_PROGRESS",
        policy_version: payload.policy_version,
      };
      const { data: call, error: callError } = await supabase
        .from("forge_rental_receptionist_calls")
        .upsert(callRow, { onConflict: "owner_id,provider_call_sid" })
        .select("id")
        .single();
      if (callError) throw callError;

      // Go-live: the worker attaches the emergency alert record (when
      // the call had an emergency) so the inbox timeline shows attempts
      // + ACKs. The alerts table was previously read but never written
      // by any code path — this upsert is what populates it. Idempotent
      // on (owner_id, emergency_event_id); the dispatcher is the source
      // of truth, so a re-delivery carries its current state (a stale
      // replay never reaches here — the nonce claim returns the
      // committed result first). Attempts are idempotent on dedupe_key.
      // REFUSED is a valid resolution_state (go-live migration widens
      // the CHECK); refused_reason says why the gate refused the send.
      const alertPayload = payload.alert;
      if (alertPayload && typeof alertPayload.emergency_event_id === "string") {
        const { error: alertError } = await supabase
          .from("forge_rental_receptionist_alerts")
          .upsert({
            owner_id: ownerId,
            emergency_event_id: alertPayload.emergency_event_id,
            hazard: alertPayload.hazard || "UNKNOWN",
            detected_at: alertPayload.detected_at ? new Date(alertPayload.detected_at * 1000).toISOString() : undefined,
            human_ack_at: alertPayload.human_ack_at ? new Date(alertPayload.human_ack_at * 1000).toISOString() : null,
            ack_method: alertPayload.ack_method || null,
            backup_attempted_at: alertPayload.backup_attempted_at ? new Date(alertPayload.backup_attempted_at * 1000).toISOString() : null,
            resolution_state: ["UNRESOLVED", "ACKNOWLEDGED", "DEAD_LETTER", "REFUSED"].includes(alertPayload.resolution_state)
              ? alertPayload.resolution_state : "UNRESOLVED",
            refused_reason: alertPayload.refused_reason || null,
          }, { onConflict: "owner_id,emergency_event_id" });
        if (alertError) throw alertError;
        const attempts = Array.isArray(alertPayload.attempts) ? alertPayload.attempts : [];
        for (const attempt of attempts) {
          if (!attempt?.attempt_id) continue;
          const { error: attemptError } = await supabase
            .from("forge_rental_receptionist_alert_attempts")
            .insert({
              owner_id: ownerId,
              emergency_event_id: alertPayload.emergency_event_id,
              target_role: attempt.role,
              channel: attempt.channel,
              attempt_no: attempt.attempt || 1,
              provider_sid: attempt.provider_sid || null,
              state: ["PENDING", "ACCEPTED", "DELIVERED", "FAILED"].includes(attempt.state) ? attempt.state : "PENDING",
              failure_class: attempt.failure_class || null,
              requested_at: attempt.requested_at ? new Date(attempt.requested_at * 1000).toISOString() : null,
              provider_accepted_at: attempt.provider_accepted_at ? new Date(attempt.provider_accepted_at * 1000).toISOString() : null,
              delivered_at: attempt.delivered_at ? new Date(attempt.delivered_at * 1000).toISOString() : null,
              failed_at: attempt.failed_at ? new Date(attempt.failed_at * 1000).toISOString() : null,
              dedupe_key: attempt.attempt_id,
            });
          if (attemptError && attemptError.code !== "23505") throw attemptError;
        }
      }

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
        // Idempotent upsert on (owner_id, call_id, draft_kind): a replayed
        // or duplicate delivery collapses onto the existing PENDING draft
        // instead of minting a second one. First insert wins
        // (ignoreDuplicates): a replay must never reset an already-reviewed
        // draft back to PENDING. ON CONFLICT DO NOTHING returns zero rows
        // on the conflict path, so read the id back owner-scoped instead
        // of .single() — .single() 500s on zero rows (P1-3).
        const { data: draftRows, error: draftError } = await supabase
          .from("forge_rental_receptionist_drafts")
          .upsert(
            {
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
            },
            { onConflict: "owner_id,call_id,draft_kind", ignoreDuplicates: true },
          )
          .select("id");
        if (draftError) throw draftError;
        draftId = draftRows?.[0]?.id || null;
        if (!draftId) {
          const { data: existing, error: existingError } = await supabase
            .from("forge_rental_receptionist_drafts")
            .select("id")
            .eq("owner_id", ownerId)
            .eq("call_id", call.id)
            .eq("draft_kind", payload.draft_kind)
            .maybeSingle();
          if (existingError) throw existingError;
          draftId = existing?.id || null;
        }
        if (draftId) {
          // The maintenance_draft_id update is load-bearing: a silent
          // failure here would orphan the draft from its call. Surface it.
          const { error: linkError } = await supabase.from("forge_rental_receptionist_calls")
            .update({ maintenance_draft_id: draftId }).eq("id", call.id).eq("owner_id", ownerId);
          if (linkError) throw linkError;
        }
      }

      const result = { success: true, callId: call.id, draftId };
      // Commit the nonce — and CHECK the boolean (fix round 3, P1-2).
      // An RPC error, or a false return (no row transitioned: the
      // lease was taken over, the nonce expired, or the row is gone),
      // means the commit is unconfirmed. The records landed, but the
      // caller must NOT be told success:true as if replay protection
      // were committed: release the claim with our token (fenced — a
      // stale token changes nothing) so an identical retry can re-run
      // the idempotent writes and commit, and return an honest
      // retryable 503.
      const { data: completed, error: completeError } = await supabase.rpc(
        "receptionist_complete_ingest_nonce",
        { p_owner_id: ownerId, p_nonce: nonce, p_request_hash: requestHash,
          p_call_id: call.id, p_result: result, p_lease_token: leaseToken },
      );
      if (completeError || completed !== true) {
        console.error("Receptionist ingest nonce completion failed",
          completeError ?? new Error("complete_ingest_nonce returned false"));
        try {
          await supabase.rpc("receptionist_fail_ingest_nonce",
            { p_owner_id: ownerId, p_nonce: nonce, p_request_hash: requestHash,
              p_lease_token: leaseToken });
        } catch {
          // Best-effort only; the 503 below already reports the failure.
        }
        return NextResponse.json(
          { error: "Ingest records saved but completion could not be confirmed; retry the delivery." },
          { status: 503 });
      }
      return NextResponse.json(result);
    } catch (error) {
      // The delivery did not land: mark the nonce FAILED so an
      // identical retry re-runs the ingest instead of being told it is
      // already a duplicate. The fail is fenced by our lease token —
      // if another worker took the lease over, it changes nothing.
      // Swallow fail-path errors here — the original error is the one
      // the caller must see.
      try {
        await supabase.rpc("receptionist_fail_ingest_nonce",
          { p_owner_id: ownerId, p_nonce: nonce, p_request_hash: requestHash,
            p_lease_token: leaseToken });
      } catch {
        // Best-effort only; the 500 below already reports the failure.
      }
      throw error;
    }
  } catch (error) {
    console.error("Receptionist ingest error", error);
    return NextResponse.json({ error: "Unable to ingest the call record." }, { status: 500 });
  }
}
