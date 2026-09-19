import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";
import { SupabaseFinancialEventRepository } from "@/domains/financial-event/SupabaseFinancialEventRepository";
import { computeCategorySuggestion, addMonths } from "@/domains/budgeting/budgetSuggestion";
import { groupEventsByCategory } from "@/domains/budgeting/groupEventsByCategory";
import { categoryFamilyOf } from "@/domains/budgeting/categoryFamily";
import { resolveCategoryDisplayLabel } from "@/domains/budgeting/categoryDisplayLabel";
import { parseBudgetScope } from "@/domains/budgeting/parseBudgetScope";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const LOOKBACK_MONTHS = 3;

// Returns one suggestion per category *family* with at least one expense event in the lookback
// window -- parent/child import categories (e.g. "dining_drinks" + "dining_drinks_restaurants")
// combine into a single suggestion instead of near-duplicate cards. A family with zero history in
// the window is simply absent rather than present with a fabricated null entry.
export async function GET(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });
  }
  const businessScope = parseBudgetScope(searchParams);
  if (businessScope === null) {
    return NextResponse.json({ error: "scope must be 'personal' or 'business'." }, { status: 400 });
  }

  const sinceMonth = addMonths(month, -LOOKBACK_MONTHS);
  const sinceDate = `${sinceMonth}-01`;

  const repository = new SupabaseFinancialEventRepository({ supabaseClient: authenticated.supabaseClient });

  let events;
  try {
    events = await repository.findExpenseEventsSince({
      ownerId: authenticated.effectiveOwnerId,
      businessScope,
      sinceDate,
    });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    return NextResponse.json({ error: "Unable to load spending history." }, { status: 500 });
  }

  const eventsByCategory = groupEventsByCategory(
    events.map((row) => ({
      eventDate: row.event_date,
      amount: row.amount,
      normalizedCategory: categoryFamilyOf(row.normalized_category),
    })),
  );

  // Member categories per family, so the card can say what it combined ("Restaurants, Coffee").
  // Only non-root members are listed -- a family that is just its root shows no members.
  const membersByFamily = new Map();
  for (const row of events) {
    const family = categoryFamilyOf(row.normalized_category);
    if (row.normalized_category && row.normalized_category !== family) {
      if (!membersByFamily.has(family)) membersByFamily.set(family, new Set());
      membersByFamily.get(family).add(row.normalized_category);
    }
  }

  const asOfDate = `${month}-01`;
  const categories = [...eventsByCategory.entries()]
    .map(([normalizedCategory, categoryEvents]) => {
      const suggestion = computeCategorySuggestion({ events: categoryEvents, asOfDate, lookbackMonths: LOOKBACK_MONTHS });
      return {
        normalizedCategory,
        displayLabel: resolveCategoryDisplayLabel(normalizedCategory),
        suggestedAmountCents: suggestion.suggestedAmountCents,
        sampleMonths: suggestion.sampleMonths,
        memberCategories: [...(membersByFamily.get(normalizedCategory) ?? [])].sort(),
      };
    })
    .filter((entry) => entry.sampleMonths > 0)
    .sort((a, b) => (b.suggestedAmountCents ?? 0) - (a.suggestedAmountCents ?? 0));

  return NextResponse.json({ success: true, month, categories });
}
