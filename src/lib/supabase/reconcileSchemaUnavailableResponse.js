import { NextResponse } from "next/server";

// Mirrors budgetingSchemaUnavailableResponse.js / privateFinancingSchemaUnavailableResponse.js.
export const RECONCILE_SCHEMA_UNAVAILABLE_CODE = "reconcile_duplicates_schema_unavailable";

export function reconcileSchemaUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Duplicate reconciliation has not been activated for this environment yet.",
      code: RECONCILE_SCHEMA_UNAVAILABLE_CODE,
    },
    { status: 503 },
  );
}
