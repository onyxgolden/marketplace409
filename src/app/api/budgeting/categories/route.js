import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";

const SOURCE_TYPES = new Set(["manual", "history_suggested"]);
const BUSINESS_SCOPE = "personal";

function rowToCategory(row) {
  return {
    id: row.id,
    normalizedCategory: row.normalized_category,
    displayLabel: row.display_label,
    sourceType: row.source_type,
  };
}

// RLS (budget_categories_owner_all -> has_workspace_access(owner_id)) scopes this to the caller's
// own workspace with no separate .eq("owner_id", ...) filter needed, matching
// /api/private-financing/accounts' own precedent.
export async function GET() {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const result = await authenticated.supabaseClient
    .from("budget_categories")
    .select("*")
    .eq("business_scope", BUSINESS_SCOPE)
    .eq("is_archived", false)
    .order("display_label", { ascending: true });

  if (result.error && isMissingRemoteSchemaError(result.error)) return budgetingSchemaUnavailableResponse();
  if (result.error) return NextResponse.json({ error: "Unable to load budget categories." }, { status: 500 });

  return NextResponse.json({ success: true, categories: (result.data || []).map(rowToCategory) });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const body = await request.json().catch(() => ({}));
  const normalizedCategory = typeof body.normalizedCategory === "string" ? body.normalizedCategory.trim() : "";
  const displayLabel = typeof body.displayLabel === "string" ? body.displayLabel.trim() : "";
  const sourceType = typeof body.sourceType === "string" ? body.sourceType : "manual";

  if (!normalizedCategory || !displayLabel) {
    return NextResponse.json({ error: "normalizedCategory and displayLabel are required." }, { status: 400 });
  }
  // Defense in depth -- the RPC's own CHECK constraint validates this too, but rejecting early
  // avoids a round trip for the common case of a typo'd sourceType.
  if (!SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: "Unrecognized sourceType." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("upsert_budget_category", {
    p_owner_id: authenticated.effectiveOwnerId,
    p_normalized_category: normalizedCategory,
    p_display_label: displayLabel,
    p_business_scope: BUSINESS_SCOPE,
    p_source_type: sourceType,
  });

  if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
  if (error) return NextResponse.json({ error: "Unable to create this budget category." }, { status: 400 });

  return NextResponse.json({ success: true, category: rowToCategory(data) });
}
