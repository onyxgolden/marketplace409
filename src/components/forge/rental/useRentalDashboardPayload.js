"use client";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { getRentalSummaryPayload } from "./rentalSummaryClient";

// Shared SWR key for the rental dashboard payload (/api/rental + /api/rental/reports).
// RentalOverviewPanel and the Today's Priorities session both consume it, so a full
// page reload hydrates both from the localStorage disk cache instantly and they
// revalidate in the background -- no more "Loading..." flash on the dashboard.
//
// Reports stay soft in the fetcher: it never throws for an unavailable report.
// Each consumer keeps its own semantics -- the overview treats an unavailable
// report as fatal, priorities keeps the other categories working.
export const RENTAL_DASHBOARD_PAYLOAD_SWR_KEY = "rental:dashboard-summary";

const DASHBOARD_PAYLOAD_TTL_MS = 30000;

function fetchDashboardPayload() {
  return getRentalSummaryPayload();
}

/**
 * useRentalDashboardPayload({ disabled })
 *
 * Shared stale-while-revalidate binding for the dashboard payload. Pass
 * { disabled: true } when the caller already has server-provided data (the
 * overview's initialData path) -- the hook then never fetches.
 */
export function useRentalDashboardPayload({ disabled = false } = {}) {
  return useStaleWhileRevalidate(
    disabled ? null : RENTAL_DASHBOARD_PAYLOAD_SWR_KEY,
    fetchDashboardPayload,
    { ttlMs: DASHBOARD_PAYLOAD_TTL_MS },
  );
}

export default useRentalDashboardPayload;
