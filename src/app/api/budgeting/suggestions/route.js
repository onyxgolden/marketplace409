import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";
import { SupabaseFinancialEventRepository } from "@/domains/financial-event/SupabaseFinancialEventRepository";
import { computeCategorySuggestion, addMonths } from "@/domains/budgeting/budgetSuggestion";
import { groupEventsByCategory } from "@/domains/budgeting/groupEventsByCategory";
import { resolveCategoryDisplayLabel } from "@/domains/budgeting/categoryDisplayLabel";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const LOOKBACK_MONTHS = 3;
// v1 only ever suggests against the household's own spending -- a business_scope selector is a
// later feature, not this one.
const BUSINESS_SCOPE = "personal";

// Returns one suggestion per category that has at least one expense event in the lookback window --
// there is no fixed master category list to enumerate against, so a category with zero history in
// the window is simply absent rather than present with a fabricated null entry.
export async function GET(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });
  }

  const sinceMonth = addMonths(month, -LOOKBACK_MONTHS);
  const sinceDate = `${sinceMonth}-01`;

  const repository = new SupabaseFinancialEventRepository({ supabaseClient: authenticated.supabaseClient });

  let events;
  try {
    events = await repository.findExpenseEventsSince({
      ownerId: authenticated.effectiveOwnerId,
      businessScope: BUSINESS_SCOPE,
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
      normalizedCategory: row.normalized_category,
    })),
  );

  const asOfDate = `${month}-01`;
  const categories = [...eventsByCategory.entries()]
    .map(([normalizedCategory, categoryEvents]) => {
      const suggestion = computeCategorySuggestion({ events: categoryEvents, asOfDate, lookbackMonths: LOOKBACK_MONTHS });
      return {
        normalizedCategory,
        displayLabel: resolveCategoryDisplayLabel(normalizedCategory),
        suggestedAmountCents: suggestion.suggestedAmountCents,
        sampleMonths: suggestion.sampleMonths,
      };
    })
    .filter((entry) => entry.sampleMonths > 0)
    .sort((a, b) => (b.suggestedAmountCents ?? 0) - (a.suggestedAmountCents ?? 0));

  return NextResponse.json({ success: true, month, categories });
}
