// Shared live-data client for the Rental dashboard surface.
//
// RentalOverviewPanel and RentalTodaysPrioritiesPanel (via useTodaysPrioritiesSession)
// both need the same two payloads (/api/rental and /api/rental/reports). They used to fetch
// them independently, so a transient network blip could fail one panel while the other's
// identical request succeeded -- exactly the "Failed to fetch" Jason saw on Today's Priorities
// while the dashboard cards above it rendered fine.
//
// This module fixes that two ways:
//   1. In-flight dedup: concurrent callers share a single network pair. The overview and the
//      priorities panel mount together, so they now issue ONE /api/rental + ONE /api/rental/reports.
//   2. Retry on network-level failures only: a rejected fetch (TypeError "Failed to fetch") or a
//      body that won't parse as JSON is retried with a short backoff. An HTTP !ok is the server's
//      definitive answer and is never retried.
//
// Endpoint contract (unchanged from the two previous call sites):
//   - /api/rental is a hard requirement: !ok throws Error(body.error || "Rental summary could not be loaded.").
//   - /api/rental/reports is soft: it never throws. Failure is reported as
//     { available: false, report: null, error } so callers keep their existing semantics -- the
//     overview treats an unavailable report as fatal, the priorities hook keeps the other
//     categories working and marks report-dependent steps unavailable.

const RENTAL_SUMMARY_URL = "/api/rental";
const RENTAL_REPORTS_URL = "/api/rental/reports";

// Two backoff steps => three total attempts per endpoint, under a second of added latency
// in the worst transient case.
const DEFAULT_RETRY_DELAYS_MS = [250, 750];

let inflightPayloadPromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches one endpoint and parses its JSON body, retrying network-level failures only.
// A rejected fetch (e.g. TypeError "Failed to fetch") or a 2xx body that won't parse as JSON
// is retried; an HTTP !ok response is returned as-is -- the server gave a definitive answer.
async function fetchJsonWithNetworkRetry(url, delaysMs) {
  let attempt = 0;
  for (;;) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // Definitive server answer: parse the error body if we can, never retry.
        // A literal `null` (or other non-object) JSON body parses fine, so the
        // .catch fallback never applies -- normalize it here instead of letting
        // callers crash on `.error` of null and mask the default message.
        const parsed = await response.json().catch(() => ({}));
        const body = parsed && typeof parsed === "object" ? parsed : {};
        return { response, body };
      }
      const body = await response.json();
      return { response, body };
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await delay(delaysMs[attempt]);
      attempt += 1;
    }
  }
}

async function loadRentalSummaryPayload(retryDelaysMs) {
  const { response: rentalResponse, body: rentalBody } = await fetchJsonWithNetworkRetry(RENTAL_SUMMARY_URL, retryDelaysMs);
  if (!rentalResponse.ok) throw new Error(rentalBody.error || "Rental summary could not be loaded.");

  // Reports stays soft, exactly as the priorities hook treated it before: only the two
  // report-dependent needs-attention categories need it, so its failure must not fail the
  // whole payload -- the caller decides what an unavailable report means.
  const reports = await fetchJsonWithNetworkRetry(RENTAL_REPORTS_URL, retryDelaysMs)
    .then(({ response, body }) => {
      if (!response.ok) throw new Error(body.error || "Rental report could not be loaded.");
      return { available: true, report: body.report, error: "" };
    })
    .catch((reason) => ({ available: false, report: null, error: reason?.message || "Rental report could not be loaded." }));

  return { rentalBody, reports };
}

// Returns { rentalBody, reports: { available, report, error } }.
//
// Concurrent callers share the in-flight network pair; the entry is cleared on settle so the
// next call fetches fresh. Pass { refresh: true } to bypass a shared in-flight pair and force
// a fresh fetch (used by the priorities "Next"/"Retry" paths, which must always evaluate
// against current authoritative state). retryDelaysMs is configurable for tests.
export function getRentalSummaryPayload({ refresh = false, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
  if (!refresh && inflightPayloadPromise) return inflightPayloadPromise;
  const pending = loadRentalSummaryPayload(retryDelaysMs);
  const tracked = pending.finally(() => {
    if (inflightPayloadPromise === tracked) inflightPayloadPromise = null;
  });
  if (!refresh) inflightPayloadPromise = tracked;
  return tracked;
}

// Test-only escape hatch: drops the in-flight entry so tests never share network state.
export function resetRentalSummaryClient() {
  inflightPayloadPromise = null;
}
