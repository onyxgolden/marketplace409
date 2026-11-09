import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { resolveOperationOwner } from "@/lib/receptionist/ingestAuth";

// POST /api/rental/receptionist/operator/kill — owner-only kill switch.
// Body: { action: "kill" | "unkill", reason?: string }.
// The caller must be the operation's owner or co-owner (fix round 1,
// P1-2): the route forwards a privileged server-side operator token to
// the voice worker, so authenticating the session is not enough — a
// lower-privilege workspace member (manager, bookkeeper, read-only)
// with a valid session could otherwise clear an emergency kill switch,
// and the worker's Bearer check cannot tell the web route acted as a
// confused deputy. Both kill AND unkill require the role, before either
// action is forwarded. The voice worker then verifies the server-side
// operator token. The worker is the authority: without
// RECEPTIONIST_WORKER_URL configured this route 503s instead of
// pretending the kill happened. A kill ends live sessions immediately
// and routes new calls to human voicemail/forwarding.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    // Owner/co-owner only: true for the primary owner (no
    // workspace_members row) and an active co_owner, false for manager,
    // bookkeeper, and read_only staff.
    const isOwner = await isOwnerOrActiveCoOwner({
      supabaseClient: authenticated.supabaseClient,
      actorUserId: authenticated.user.id,
    });
    if (!isOwner) {
      return NextResponse.json(
        { error: "Only the owner or co-owner may operate the kill switch." },
        { status: 403 });
    }
    // Cross-owner: when the operation -> owner mapping is configured,
    // the caller must act within the operation owner's workspace — an
    // owner of a different workspace must not kill this operation's
    // worker. Unconfigured mapping means the check cannot run; the
    // role check above still applies.
    const operationOwner = resolveOperationOwner(
      process.env.RECEPTIONIST_OPERATION_ID || "brandy-rental-office");
    if (operationOwner && authenticated.effectiveOwnerId !== operationOwner) {
      return NextResponse.json(
        { error: "Only the operation owner may operate the kill switch." },
        { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const action = body.action;
    if (action !== "kill" && action !== "unkill") {
      return NextResponse.json({ error: "action must be kill or unkill." }, { status: 400 });
    }
    const workerUrl = (process.env.RECEPTIONIST_WORKER_URL || "").replace(/\/$/, "");
    if (!workerUrl) {
      return NextResponse.json(
        { error: "Voice worker is not configured (RECEPTIONIST_WORKER_URL); the kill switch cannot be reached." },
        { status: 503 });
    }
    const operatorToken = process.env.RECEPTIONIST_OPERATOR_TOKEN || "";
    if (!operatorToken) {
      return NextResponse.json(
        { error: "Operator token is not configured; the kill switch cannot be reached." },
        { status: 503 });
    }
    const res = await fetch(`${workerUrl}/operator/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${operatorToken}` },
      body: JSON.stringify({ reason: body.reason || "operator action from the inbox", set_by: "inbox" }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: json.error || "Voice worker refused the kill switch action." },
        { status: res.status });
    }
    return NextResponse.json({ success: true, ...json });
  } catch (error) {
    console.error("Receptionist kill switch error", error);
    return NextResponse.json({ error: "Unable to reach the kill switch." }, { status: 500 });
  }
}
