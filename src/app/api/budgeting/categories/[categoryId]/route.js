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
    note: row.note ?? null,
  };
}

// Updates a budget category's display label and/or note. At least one of the two must be present;
// each is applied via its own RPC (only when provided) so a note-only save never touches the label
// and vice versa. `note: ""` is a valid, meaningful request -- it clears an existing note.
export async function PATCH(request, { params }) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { categoryId } = await params;
  const body = await request.json().catch(() => ({}));
  const hasDisplayLabel = typeof body.displayLabel === "string" && body.displayLabel.trim() !== "";
  const hasNote = typeof body.note === "string";

  if (!categoryId || (!hasDisplayLabel && !hasNote)) {
    return NextResponse.json({ error: "categoryId and at least one of displayLabel or note are required." }, { status: 400 });
  }

  let row = null;

  if (hasDisplayLabel) {
    const { data, error } = await authenticated.supabaseClient.rpc("rename_budget_category", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_category_id: categoryId,
      p_display_label: body.displayLabel.trim(),
    });
    if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    if (error && error.code === "P0002") return NextResponse.json({ error: "Unknown budget category." }, { status: 404 });
    if (error) return NextResponse.json({ error: "Unable to rename this budget category." }, { status: 400 });
    row = data;
  }

  if (hasNote) {
    const { data, error } = await authenticated.supabaseClient.rpc("update_budget_category_note", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_category_id: categoryId,
      p_note: body.note,
    });
    if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    if (error && error.code === "P0002") return NextResponse.json({ error: "Unknown budget category." }, { status: 404 });
    if (error) return NextResponse.json({ error: "Unable to save this note." }, { status: 400 });
    row = data;
  }

  return NextResponse.json({ success: true, category: rowToCategory(row) });
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
