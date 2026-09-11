// Standard "financial data provider unavailable" response for authenticated financial routes.
// Used whenever createFinancialApplicationSuite/createFinancialSnapshotApplication resolve
// reportingApplication or snapshotApplication to null because no real financial data provider is
// configured (see createFinancialApplicationSuite.js -- there is deliberately no implicit demo-data
// fallback in production composition). 503 is used, not 200 with an empty/zeroed body: a real
// caller must never be able to mistake "we have nothing to tell you right now" for "your real
// balance is zero." No stack trace, internal configuration, or secret ever belongs in this body.
export function financialDataUnavailableResponse() {
  return Response.json(
    {
      success: false,
      error:
        "Financial reports and snapshots are temporarily unavailable. Please try again later.",
    },
    { status: 503 },
  );
}
