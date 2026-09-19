import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { detectRecurringPayments } from "@/domains/financial-event/detectRecurringPayments";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

async function fetchIncomeExpenseRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, transaction_kind, normalized_category, financial_account_id")
      .eq("owner_id", ownerId)
      .eq("is_deleted", false)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .in("transaction_kind", ["income", "expense"])
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchAccountNamesById(supabaseClient, ownerId, accountIds) {
  const namesById = new Map();
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return namesById;
  const { data, error } = await supabaseClient
    .from("financial_accounts")
    .select("id, name")
    .eq("owner_id", ownerId)
    .in("id", uniqueIds);
  if (error) throw error;
  for (const row of data ?? []) namesById.set(row.id, row.name);
  return namesById;
}

// Read-only detection: finds subscriptions, loan payments, paychecks, and other repeating
// income/expense patterns. No writes, nothing to confirm -- the panel just reports.
export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const transactionRows = await fetchIncomeExpenseRows(authenticated.supabaseClient, authenticated.effectiveOwnerId);
    const namesById = await fetchAccountNamesById(
      authenticated.supabaseClient,
      authenticated.effectiveOwnerId,
      transactionRows.map((row) => row.financial_account_id),
    );
    const patterns = detectRecurringPayments(
      transactionRows.map((row) => ({
        id: row.id,
        eventDate: row.event_date,
        amount: Number(row.amount),
        accountId: row.financial_account_id,
        accountName: namesById.get(row.financial_account_id) ?? null,
        transactionKind: row.transaction_kind,
        normalizedCategory: row.normalized_category,
      })),
    );
    return NextResponse.json({ success: true, patterns, rowCount: transactionRows.length });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) {
      return NextResponse.json({ error: "Recurring-payment detection isn't available yet.", code: "recurring_schema_unavailable" }, { status: 503 });
    }
    console.error("Recurring payments detection error", error);
    return NextResponse.json({ error: "Unable to detect recurring payments." }, { status: 500 });
  }
}
