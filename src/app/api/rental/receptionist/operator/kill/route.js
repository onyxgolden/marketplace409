import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// POST /api/rental/receptionist/operator/kill — owner-only kill switch.
// Body: { action: "kill" | "unkill", reason?: string }.
// The caller must be an authenticated rental owner/co-owner (the same
// gate as the rest of the inbox); the voice worker then verifies the
// server-side operator token. The worker is the authority: without
// RECEPTIONIST_WORKER_URL configured this route 503s instead of
// pretending the kill happened. A kill ends live sessions immediately
// and routes new calls to human voicemail/forwarding.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
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
