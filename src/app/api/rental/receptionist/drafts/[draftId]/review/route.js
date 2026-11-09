import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// POST /api/rental/receptionist/drafts/[draftId]/review
// Body: { reviewState: "APPROVED" | "REJECTED" | "NEEDS_INFO", version, reason? }
// Review gate (brief §7/§11.9): a draft is NOT a canonical record until an
// authorized owner/co-owner review approves it. Approval is transactional
// and exactly-once: the update is version-guarded (optimistic concurrency),
// so concurrent approvals collapse to one winner and the loser gets 409.
// The actor comes from the authenticated session, never the request body.
//
// P2-2 — an approval here is a PRELIMINARY review decision ONLY. It does
// NOT create a canonical lead or maintenance request: the draft carries
// only unverified claimed tenant/property hints, and the canonical
// maintenance table requires a verified lease/unit/tenant link the draft
// does not have. The response says so explicitly
// (canonicalRecordCreated: false + goLiveGate) so no caller can mistake
// a review-only approval for a dispatched maintenance request. Canonical
// creation stays a follow-up behind the go-live gate.
// Read-only roles cannot approve: the rental manager application
// resolves only owner/co-owner workspaces for writes.
const VALID_STATES = new Set(["APPROVED", "REJECTED", "NEEDS_INFO"]);

// Canonical creation is NOT implemented in v1 (see header). Any caller
// presenting an approval as a dispatched record is wrong; the gate name
// below is the stable marker for it.
const CANONICAL_CREATION_GATE = "CANONICAL_CREATION_NOT_IMPLEMENTED";

export async function POST(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;
    const { draftId } = await params;
    const body = await request.json().catch(() => ({}));
    if (!VALID_STATES.has(body?.reviewState)) {
      return NextResponse.json({ error: "reviewState must be APPROVED, REJECTED, or NEEDS_INFO." }, { status: 400 });
    }
    if (typeof body?.version !== "number") {
      return NextResponse.json({ error: "version is required for exactly-once review." }, { status: 400 });
    }
    const { data: updated, error } = await supabaseClient
      .from("forge_rental_receptionist_drafts")
      .update({
        review_state: body.reviewState,
        reviewed_by: user?.id || null,
        reviewed_at: new Date().toISOString(),
        review_reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        version: body.version + 1,
      })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", draftId)
      .eq("version", body.version)
      .eq("review_state", "PENDING")
      .select("id, review_state, version")
      .maybeSingle();
    if (error) throw error;
    if (!updated) {
      return NextResponse.json({ error: "Draft was already reviewed or changed. Reload and try again." }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      draft: updated,
      // Preliminary decision only: no canonical record was created by
      // this approval (see header). Callers must not treat APPROVED as
      // a dispatched lead or maintenance request.
      decisionKind: "PRELIMINARY_REVIEW",
      canonicalRecordCreated: false,
      committedRecordId: null,
      goLiveGate: CANONICAL_CREATION_GATE,
    });
  } catch (error) {
    console.error("Receptionist draft review error", error);
    return NextResponse.json({ error: "Unable to record the review." }, { status: 500 });
  }
}
