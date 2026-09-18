import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";

function rowToCategory(row) {
  return {
    id: row.id,
    normalizedCategory: row.normalized_category,
    displayLabel: row.display_label,
    sourceType: row.source_type,
  };
}

// Rename a budget category's display label.
export async function PATCH(request, { params }) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { categoryId } = await params;
  const body = await request.json().catch(() => ({}));
  const displayLabel = typeof body.displayLabel === "string" ? body.displayLabel.trim() : "";

  if (!categoryId || !displayLabel) {
    return NextResponse.json({ error: "categoryId and a non-empty displayLabel are required." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("rename_budget_category", {
    p_owner_id: authenticated.effectiveOwnerId,
    p_category_id: categoryId,
    p_display_label: displayLabel,
  });

  if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
  if (error && error.code === "P0002") return NextResponse.json({ error: "Unknown budget category." }, { status: 404 });
  if (error) return NextResponse.json({ error: "Unable to rename this budget category." }, { status: 400 });

  return NextResponse.json({ success: true, category: rowToCategory(data) });
}

// Archives (soft-deletes) a budget category -- its past monthly allocations are preserved, it just
// stops appearing in the active budget view and can no longer receive new allocations.
export async function DELETE(request, { params }) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { categoryId } = await params;
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("archive_budget_category", {
    p_owner_id: authenticated.effectiveOwnerId,
    p_category_id: categoryId,
  });

  if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
  if (error && error.code === "P0002") return NextResponse.json({ error: "Unknown budget category." }, { status: 404 });
  if (error) return NextResponse.json({ error: "Unable to remove this budget category." }, { status: 400 });

  return NextResponse.json({ success: true, category: rowToCategory(data) });
}
