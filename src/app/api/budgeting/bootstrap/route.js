import { NextResponse } from "next/server";
import { createAuthenticatedBudgetingApplication } from "@/lib/supabase/createAuthenticatedBudgetingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { budgetingSchemaUnavailableResponse } from "@/lib/supabase/budgetingSchemaUnavailableResponse";
import { detectRecurringByPayee } from "@/domains/financial-event/detectRecurringByPayee";
import { categoryFamilyOf } from "@/domains/budgeting/categoryFamily";
import { resolveCategoryDisplayLabel } from "@/domains/budgeting/categoryDisplayLabel";
import { isValidBudgetScope, parseBudgetScope } from "@/domains/budgeting/parseBudgetScope";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const PAGE_SIZE = 1000;
// A full year of history: monthly bills need several occurrences to qualify,
// quarterly bills need at least three.
const LOOKBACK_MONTHS = 12;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

// Read-only first-run bootstrap analysis: scans the caller's transaction history
// for recurring bills (outbound) and recurring income (inbound), grouped by
// payee, and returns them as pre-checked candidates for the confirmation
// screen. Nothing is written here -- the POST endpoint below is the only writer.
async function fetchTransactionRows(supabaseClient, ownerId, businessScope, sinceDate) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, transaction_kind, normalized_category, description")
      .eq("owner_id", ownerId)
      .eq("business_scope", businessScope)
      .eq("is_deleted", false)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .in("transaction_kind", ["income", "expense"])
      .gte("event_date", sinceDate)
      .order("event_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function plannedFamilies(supabaseClient, businessScope) {
  const { data, error } = await supabaseClient
    .from("budget_categories")
    .select("normalized_category")
    .eq("business_scope", businessScope)
    .eq("is_archived", false);
  if (error) throw error;
  return new Set((data ?? []).map((row) => categoryFamilyOf(row.normalized_category) ?? row.normalized_category));
}

function lookbackStartIso() {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - LOOKBACK_MONTHS);
  return date.toISOString().slice(0, 10);
}

function candidateDto(candidate) {
  const family = candidate.category ? (categoryFamilyOf(candidate.category) ?? candidate.category) : null;
  return {
    id: candidate.payeeKey,
    payeeLabel: candidate.payeeLabel,
    category: family,
    displayLabel: family ? resolveCategoryDisplayLabel(family) : "Uncategorized",
    cadence: candidate.cadence,
    occurrences: candidate.occurrences,
    medianAmountCents: Math.round(candidate.medianAmount * 100),
    monthlyAmountCents: Math.round(candidate.monthlyAmount * 100),
    nextExpectedDate: candidate.nextExpectedDate,
  };
}

export async function GET(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const { searchParams } = new URL(request.url);
  const businessScope = parseBudgetScope(searchParams);
  if (businessScope === null) {
    return NextResponse.json({ error: "scope must be 'personal' or 'business'." }, { status: 400 });
  }

  const sinceDate = lookbackStartIso();
  let transactionRows;
  let alreadyPlanned;
  try {
    [transactionRows, alreadyPlanned] = await Promise.all([
      fetchTransactionRows(authenticated.supabaseClient, authenticated.effectiveOwnerId, businessScope, sinceDate),
      plannedFamilies(authenticated.supabaseClient, businessScope),
    ]);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    return NextResponse.json({ error: "Unable to analyze your transaction history." }, { status: 500 });
  }

  const candidates = detectRecurringByPayee(
    transactionRows.map((row) => ({
      id: row.id,
      eventDate: row.event_date,
      amount: Number(row.amount),
      description: row.description,
      transactionKind: row.transaction_kind,
      normalizedCategory: row.normalized_category,
    })),
  );

  // Bills need a decided category to become a budget line -- uncategorized
  // ("other") patterns stay out until someone classifies them, matching the
  // budget panel's own recurring-suggestions rule.
  const bills = candidates
    .filter((candidate) => candidate.direction === "outbound")
    .filter((candidate) => candidate.category && candidate.category !== "other")
    .filter((candidate) => !alreadyPlanned.has(categoryFamilyOf(candidate.category) ?? candidate.category))
    .map(candidateDto);
  // Income is informational: it already feeds the budget's income totals, so
  // there is nothing to confirm -- but first-run users deserve to see that the
  // scan noticed it.
  const income = candidates
    .filter((candidate) => candidate.direction === "inbound")
    .map(candidateDto);

  return NextResponse.json({
    success: true,
    scope: businessScope,
    eventsAnalyzed: transactionRows.length,
    lookbackStart: sinceDate,
    bills,
    income,
  });
}

// Confirms the bootstrap: writes budget categories (source "history_suggested")
// plus this month's planned allocations for exactly the items the user kept
// checked. Items the user deselected are never sent by the client and never
// written here. Multiple kept payees that map to one category family merge into
// a single line with summed amounts; families already in the budget are skipped
// rather than overwritten.
export async function POST(request) {
  const authenticated = await createAuthenticatedBudgetingApplication();
  if (authenticated.response) return authenticated.response;

  const body = await request.json().catch(() => ({}));
  const businessScope = typeof body.scope === "string" ? body.scope : "personal";
  const month = typeof body.month === "string" ? body.month.trim() : "";
  const items = Array.isArray(body.items) ? body.items : null;

  if (!isValidBudgetScope(businessScope)) {
    return NextResponse.json({ error: "scope must be 'personal' or 'business'." }, { status: 400 });
  }
  if (!MONTH_PATTERN.test(month)) {
    return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });
  }
  if (!items) {
    return NextResponse.json({ error: "items must be an array." }, { status: 400 });
  }

  // Merge kept items by category family so two payees in one family (e.g. two
  // subscriptions) become one budget line instead of clobbering each other.
  const mergedByFamily = new Map();
  for (const item of items) {
    const normalizedCategory = typeof item?.normalizedCategory === "string" ? item.normalizedCategory.trim() : "";
    const plannedAmountCents = item?.plannedAmountCents;
    if (!normalizedCategory || !Number.isInteger(plannedAmountCents) || plannedAmountCents < 0) {
      return NextResponse.json({ error: "Each item needs a normalizedCategory and a non-negative integer plannedAmountCents." }, { status: 400 });
    }
    const family = categoryFamilyOf(normalizedCategory) ?? normalizedCategory;
    const existing = mergedByFamily.get(family) ?? 0;
    mergedByFamily.set(family, existing + plannedAmountCents);
  }

  let alreadyPlanned;
  try {
    alreadyPlanned = await plannedFamilies(authenticated.supabaseClient, businessScope);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
    return NextResponse.json({ error: "Unable to save your budget." }, { status: 500 });
  }

  const created = [];
  const skipped = [];
  const periodMonth = `${month}-01`;
  for (const [family, plannedAmountCents] of mergedByFamily) {
    if (alreadyPlanned.has(family)) {
      skipped.push(family);
      continue;
    }
    try {
      const { data: categoryRow, error: categoryError } = await authenticated.supabaseClient.rpc("upsert_budget_category", {
        p_owner_id: authenticated.effectiveOwnerId,
        p_normalized_category: family,
        p_display_label: resolveCategoryDisplayLabel(family),
        p_business_scope: businessScope,
        p_source_type: "history_suggested",
      });
      if (categoryError) throw categoryError;
      const { error: allocationError } = await authenticated.supabaseClient.rpc("upsert_budget_monthly_allocation", {
        p_owner_id: authenticated.effectiveOwnerId,
        p_category_id: categoryRow.id,
        p_period_month: periodMonth,
        p_planned_amount_cents: plannedAmountCents,
      });
      if (allocationError) throw allocationError;
      created.push({
        categoryId: categoryRow.id,
        normalizedCategory: family,
        displayLabel: resolveCategoryDisplayLabel(family),
        plannedAmountCents,
      });
    } catch (error) {
      if (isMissingRemoteSchemaError(error)) return budgetingSchemaUnavailableResponse();
      return NextResponse.json({ error: "Unable to save your budget." }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true, month, created, skipped });
}
