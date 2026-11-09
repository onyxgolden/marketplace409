import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// GET /api/rental/receptionist/status — operator status for the inbox:
// activation mode, kill switch, budget, latency receipt, disclosure
// revision, alert persistence, outbox depth, live sessions.
//
// The voice worker (Python service) is the source of truth when
// RECEPTIONIST_WORKER_URL is configured: this route proxies its
// /operator/status with the server-side operator token (never exposed
// to the browser). When the worker is not configured or unreachable,
// the route falls back to the DB-derived view and says so honestly
// (worker_reachable: false) instead of inventing a mode.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const workerUrl = (process.env.RECEPTIONIST_WORKER_URL || "").replace(/\/$/, "");
    if (workerUrl) {
      const operatorToken = process.env.RECEPTIONIST_OPERATOR_TOKEN || "";
      try {
        const res = await fetch(`${workerUrl}/operator/status`, {
          headers: operatorToken ? { Authorization: `Bearer ${operatorToken}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const status = await res.json();
          return NextResponse.json({ success: true, worker_reachable: true, ...status });
        }
      } catch {
        // Fall through to the DB-derived view below.
      }
    }

    // DB-derived fallback: unresolved alerts + outbox depth + recent
    // call sources. Mode is OFF unless the worker says otherwise.
    const [{ data: alerts }, { data: outbox }, { data: recentCalls }] = await Promise.all([
      supabaseClient.from("forge_rental_receptionist_alerts")
        .select("emergency_event_id").eq("owner_id", effectiveOwnerId).eq("resolution_state", "UNRESOLVED"),
      supabaseClient.from("forge_rental_receptionist_delivery_outbox")
        .select("id").eq("owner_id", effectiveOwnerId).eq("state", "PENDING"),
      supabaseClient.from("forge_rental_receptionist_calls")
        .select("source").eq("owner_id", effectiveOwnerId).order("started_at", { ascending: false }).limit(100),
    ]);
    const sources = {};
    for (const call of recentCalls || []) {
      const source = call.source || "SYNTHETIC";
      sources[source] = (sources[source] || 0) + 1;
    }
    return NextResponse.json({
      success: true,
      worker_reachable: false,
      worker_configured: Boolean(workerUrl),
      activation_mode: "OFF",
      activation_reason: "voice worker status unavailable; mode reported OFF until the worker answers",
      kill_switch: { killed: false },
      alerts_unresolved: (alerts || []).length,
      outbox_pending: (outbox || []).length,
      recent_calls_by_source: sources,
    });
  } catch (error) {
    console.error("Receptionist status error", error);
    return NextResponse.json({ error: "Unable to load receptionist status." }, { status: 500 });
  }
}
