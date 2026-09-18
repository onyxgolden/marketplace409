import { NextResponse } from "next/server";

// Mirrors reconcileSchemaUnavailableResponse.js / budgetingSchemaUnavailableResponse.js.
export const TRANSFER_CLASSIFICATION_SCHEMA_UNAVAILABLE_CODE = "transfer_classification_schema_unavailable";

export function transferClassificationSchemaUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Transfer/distribution classification has not been activated for this environment yet.",
      code: TRANSFER_CLASSIFICATION_SCHEMA_UNAVAILABLE_CODE,
    },
    { status: 503 },
  );
}
