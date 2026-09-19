import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { detectRecurringPayments } from "@/domains/financial-event/detectRecurringPayments";
import { detectAnomalies, alertKeyOf } from "@/domains/ledger/brain/anomalies.js";
import { categoryFamilyOf } from "@/domains/budgeting/categoryFamily.js";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

// Same read path as the recurring endpoint: income/expense feed rows, with the
// description the anomaly engine needs for merchant matching.
async function fetchTransactionRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, description, transaction_kind, normalized_category, financial_account_id")
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

async function fetchAccountDetailsById(supabaseClient, ownerId, accountIds) {
  const detailsById = new Map();
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return detailsById;
  const { data, error } = await supabaseClient
    .from("financial_accounts")
    .select("id, name")
    .eq("owner_id", ownerId)
    .in("id", uniqueIds);
  if (error) throw error;
  for (const row of data ?? []) detailsById.set(row.id, row.name);
  return detailsById;
}

// Human convention for the engine: outflows (spend) positive, inflows negative,
// regardless of how the feed stores the sign.
function toHumanSignedAmount(row) {
  const magnitude = Math.abs(Number(row.amount) || 0);
  return row.transaction_kind === "income" ? -magnitude : magnitude;
}

function toEnginePostings(rows) {
  return rows.map((row) => ({
    id: row.id,
    description: row.description ?? "",
    amount: toHumanSignedAmount(row),
    categoryFamily: categoryFamilyOf(row.normalized_category),
    date: row.event_date,
  }));
}

// Maps detectRecurringPayments output to the engine's plain pattern shape.
// The detector only keeps occurrence ids, so the latest amount comes from the
// newest row among each pattern's occurrences.
function toEnginePatterns(patterns, rowsById) {
  return patterns.map((pattern) => {
    let latestAmount = null;
    let latestDate = pattern.lastDate ?? null;
    for (const id of pattern.eventIds ?? []) {
      const row = rowsById.get(id);
      if (!row) continue;
      if (latestDate == null || row.event_date > latestDate) {
        latestDate = row.event_date;
        latestAmount = Math.abs(Number(row.amount) || 0);
      }
    }
    return {
      label: pattern.category ?? pattern.accountName ?? "Recurring payment",
      medianAmount: Number(pattern.medianAmount) || 0,
      latestAmount,
      latestDate,
      cadence: pattern.cadence ?? null,
      direction: pattern.direction ?? null,
    };
  });
}

// Read-only anomaly scan over the books. No writes, nothing to confirm.
export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const rows = await fetchTransactionRows(authenticated.supabaseClient, authenticated.effectiveOwnerId);
    const detailsById = await fetchAccountDetailsById(
      authenticated.supabaseClient,
      authenticated.effectiveOwnerId,
      rows.map((row) => row.financial_account_id),
    );
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    let dismissedKeys = new Set();
    try {
      const { data: dismissed, error: dismissedError } = await authenticated.supabaseClient
        .from("dismissed_brain_alerts")
        .select("alert_key")
        .eq("owner_id", authenticated.effectiveOwnerId);
      if (dismissedError) throw dismissedError;
      dismissedKeys = new Set((dismissed ?? []).map((row) => row.alert_key));
    } catch {
      dismissedKeys = new Set();
    }

    const patterns = detectRecurringPayments(
      rows.map((row) => ({
        id: row.id,
        eventDate: row.event_date,
        amount: Number(row.amount),
        accountId: row.financial_account_id,
        accountName: detailsById.get(row.financial_account_id) ?? null,
        transactionKind: row.transaction_kind,
        normalizedCategory: row.normalized_category,
      })),
    );

    const alerts = detectAnomalies({
      postings: toEnginePostings(rows),
      recurringPatterns: toEnginePatterns(patterns, rowsById),
      now: new Date(),
    })
      .map((alert) => ({ ...alert, key: alertKeyOf(alert) }))
      // Dismissed alerts stay dismissed. Graceful when the dismissals table
      // doesn't exist yet (migration not deployed): worst case a dismissed
      // alert reappears, never a 500.
      .filter((alert) => !dismissedKeys.has(alert.key));

    return NextResponse.json({
      success: true,
      data: { alerts, generatedAt: new Date().toISOString(), rowCount: rows.length },
    });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) {
      return NextResponse.json(
        { error: "Anomaly detection isn't available yet.", code: "anomalies_schema_unavailable" },
        { status: 503 },
      );
    }
    console.error("Anomaly detection error", error);
    return NextResponse.json({ error: "Unable to scan for anomalies." }, { status: 500 });
  }
}
