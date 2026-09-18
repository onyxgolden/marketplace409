import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";
import { SupabaseFinancialEventRepository } from "@/domains/financial-event/SupabaseFinancialEventRepository";
import { addMonths } from "@/domains/budgeting/budgetSuggestion";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const BUSINESS_SCOPE = "personal";

// Joins the caller's own budget categories against that month's planned allocation (if any) and
// actual spend so far this month (summed live from financial_events -- this schema stores no
// running actuals total of its own).
export async function GET(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });
  }

  const categoriesResult = await authenticated.supabaseClient
    .from("budget_categories")
    .select("*")
    .eq("business_scope", BUSINESS_SCOPE)
    .eq("is_archived", false);

  if (categoriesResult.error && isMissingRemoteSchemaError(categoriesResult.error)) return budgetingSchemaUnavailableResponse();
  if (categoriesResult.error) return NextResponse.json({ error: "Unable to load the budget plan." }, { status: 500 });

  const categories = categoriesResult.data || [];
  if (categories.length === 0) {
    return NextResponse.json({ success: true, month, lines: [] });
  }

  const categoryIds = categories.map((row) => row.id);
  const monthStart = `${month}-01`;

  let allocationsResult;
  let expenseEvents;
  try {
    [allocationsResult, expenseEvents] = await Promise.all([
      authenticated.supabaseClient
        .from("budget_monthly_allocations")
        .select("category_id, planned_amount_cents")
        .eq("period_month", monthStart)
        .in("category_id", categoryIds),
      new SupabaseFinancialEventRepository({ supabaseClient: authenticated.supabaseClient }).findExpenseEventsSince({
        ownerId: authenticated.effectiveOwnerId,
        businessScope: BUSINESS_SCOPE,
        sinceDate: monthStart,
      }),
    ]);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    return NextResponse.json({ error: "Unable to load the budget plan." }, { status: 500 });
  }

  if (allocationsResult.error && isMissingRemoteSchemaError(allocationsResult.error)) return budgetingSchemaUnavailableResponse();
  if (allocationsResult.error) return NextResponse.json({ error: "Unable to load the budget plan." }, { status: 500 });

  const plannedByCategoryId = new Map((allocationsResult.data || []).map((row) => [row.category_id, row.planned_amount_cents]));

  const nextMonthStart = `${addMonths(month, 1)}-01`;
  const actualCentsByCategory = new Map();
  for (const event of expenseEvents) {
    if (event.event_date >= nextMonthStart) continue; // findExpenseEventsSince only has a lower bound
    const current = actualCentsByCategory.get(event.normalized_category) || 0;
    actualCentsByCategory.set(event.normalized_category, current + Math.round(event.amount * 100));
  }

  const lines = categories
    .map((category) => ({
      categoryId: category.id,
      normalizedCategory: category.normalized_category,
      displayLabel: category.display_label,
      plannedAmountCents: plannedByCategoryId.get(category.id) ?? null,
      actualAmountCents: actualCentsByCategory.get(category.normalized_category) || 0,
    }))
    .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));

  return NextResponse.json({ success: true, month, lines });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const body = await request.json().catch(() => ({}));
  const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
  const month = typeof body.month === "string" ? body.month.trim() : "";
  const plannedAmountCents = body.plannedAmountCents;

  if (!categoryId || !month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "categoryId and a valid month (YYYY-MM) are required." }, { status: 400 });
  }
  if (!Number.isInteger(plannedAmountCents) || plannedAmountCents < 0) {
    return NextResponse.json({ error: "plannedAmountCents must be a non-negative integer." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc("upsert_budget_monthly_allocation", {
    p_owner_id: authenticated.effectiveOwnerId,
    p_category_id: categoryId,
    p_period_month: `${month}-01`,
    p_planned_amount_cents: plannedAmountCents,
  });

  if (error && isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
  if (error && error.code === "P0002") return NextResponse.json({ error: "Unknown budget category." }, { status: 404 });
  if (error) return NextResponse.json({ error: "Unable to save this budget amount." }, { status: 400 });

  return NextResponse.json({
    success: true,
    allocation: { categoryId: data.category_id, month, plannedAmountCents: data.planned_amount_cents },
  });
}
