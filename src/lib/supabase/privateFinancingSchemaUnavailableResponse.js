import { NextResponse } from "next/server";

// Shared by every /api/private-financing/** route so the response shape is identical everywhere a caller
// might hit this state. Deliberately NOT the same shape as a genuine empty result: a caller must be able
// to tell "the migration hasn't been applied to this environment yet" (503 + this stable code) apart from
// "the feature is available and this workspace simply has zero accounts" (200, accounts: []), an ordinary
// transient failure (500, no code), and an authorization failure (401, from the auth factory). Never
// includes the underlying Postgres error's own message or code -- that detail is server-log-only.
export const PRIVATE_FINANCING_SCHEMA_UNAVAILABLE_CODE = "private_financing_schema_unavailable";

export function privateFinancingSchemaUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Private Financing has not been activated for this environment yet.",
      code: PRIVATE_FINANCING_SCHEMA_UNAVAILABLE_CODE,
    },
    { status: 503 },
  );
}
