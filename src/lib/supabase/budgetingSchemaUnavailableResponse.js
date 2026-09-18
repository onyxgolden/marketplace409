import { NextResponse } from "next/server";

// Mirrors privateFinancingSchemaUnavailableResponse.js exactly -- lets a caller tell "the migration
// hasn't been applied to this environment yet" (503 + this stable code) apart from a genuine empty
// result (200, categories/lines: []), an ordinary transient failure (500), or an auth failure (401).
export const BUDGETING_SCHEMA_UNAVAILABLE_CODE = "budgeting_schema_unavailable";

export function budgetingSchemaUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Budgeting has not been activated for this environment yet.",
      code: BUDGETING_SCHEMA_UNAVAILABLE_CODE,
    },
    { status: 503 },
  );
}
