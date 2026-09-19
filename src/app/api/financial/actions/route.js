import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import {
  parseActionCommand,
  ACTION_HINT,
} from "@/domains/ledger/brain/parseActionCommand.js";
import {
  buildActionPlan,
  requiredConfirmationForPlan,
  confirmationSatisfiesGate,
} from "@/domains/ledger/brain/buildActionPlan.js";
import {
  trainCategorizer,
  suggestTopCategory,
} from "@/domains/ledger/brain/categorize.js";
import {
  detectAnomalies,
  alertKeyOf,
} from "@/domains/ledger/brain/anomalies.js";
import { detectRecurringPayments } from "@/domains/financial-event/detectRecurringPayments";
import { isAmbiguousRowResolved } from "@/domains/financial-event/isAmbiguousRowResolved";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

// Categories that must go through reclassify_transaction_financial_event
// (the categorize RPC deliberately rejects them -- they need kind pairing).
const RECLASSIFY_CATEGORIES = new Set([
  "internal_transfer",
  "owner_distribution",
  "heloc_payment",
  "mortgage_payment",
  "loan_payment",
]);

const CATEGORY_SLUG = /^[a-z0-9_]{1,64}$/;

async function fetchTransactionRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select(
        "id, event_date, amount, description, transaction_kind, normalized_category, financial_account_id",
      )
      .eq("owner_id", ownerId)
      .eq("is_deleted", false)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Dismissed alert keys. Graceful when the migration hasn't been deployed yet:
// worst case a dismissed alert reappears, never a 500.
async function fetchDismissedAlertKeys(supabaseClient, ownerId) {
  try {
    const { data, error } = await supabaseClient
      .from("dismissed_brain_alerts")
      .select("alert_key")
      .eq("owner_id", ownerId);
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.alert_key));
  } catch {
    return new Set();
  }
}

// Everything the planner needs, freshly read: unresolved rows with Brain
// suggestions attached, and active (non-dismissed) anomaly alerts with keys.
async function assembleActionContext(supabaseClient, ownerId) {
  const rows = await fetchTransactionRows(supabaseClient, ownerId);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const decidedRows = rows.filter((row) => isAmbiguousRowResolved(row.normalized_category));
  const model = trainCategorizer(
    decidedRows.map((row) => ({
      description: row.description,
      amount: Number(row.amount),
      category: row.normalized_category,
    })),
  );

  const ambiguousRows = rows
    .filter((row) => !isAmbiguousRowResolved(row.normalized_category))
    .map((row) => ({
      eventId: row.id,
      eventDate: row.event_date,
      description: row.description,
      amount: Number(row.amount),
      transactionKind: row.transaction_kind,
      normalizedCategory: row.normalized_category,
      suggestion: suggestTopCategory(model, {
        description: row.description,
        amount: Number(row.amount),
      }),
    }));

  const dismissedKeys = await fetchDismissedAlertKeys(supabaseClient, ownerId);
  const alerts = detectAnomalies({
    postings: rows
      .filter((row) => row.transaction_kind === "income" || row.transaction_kind === "expense")
      .map((row) => ({
        id: row.id,
        description: row.description ?? "",
        // Human convention for the engine: outflows positive, inflows negative.
        amount:
          row.transaction_kind === "income"
            ? -Math.abs(Number(row.amount) || 0)
            : Math.abs(Number(row.amount) || 0),
        date: row.event_date,
      })),
    recurringPatterns: [],
    now: new Date(),
  })
    .map((alert) => ({ ...alert, key: alertKeyOf(alert) }))
    .filter((alert) => !dismissedKeys.has(alert.key));

  return { ambiguousRows, alerts, rowsById };
}

function planResponse(plan) {
  return NextResponse.json({
    success: true,
    data: {
      plan: {
        items: plan.items,
        summary: plan.summary,
        requiresTypedConfirm: plan.requiresTypedConfirm,
      },
      gate: requiredConfirmationForPlan(plan),
      hint: ACTION_HINT,
    },
  });
}

function isUnresolvedRow(row) {
  return row != null && !isAmbiguousRowResolved(row.normalized_category);
}

// Applies one validated plan item. Returns { ok: true } or { ok: false, error }.
async function applyItem(supabaseClient, ownerId, item, context) {
  try {
    if (item.kind === "categorize") {
      const row = context.rowsById.get(item.eventId);
      if (!isUnresolvedRow(row)) {
        return { ok: false, error: "Row is already categorized or no longer exists." };
      }
      if (!CATEGORY_SLUG.test(item.category ?? "")) {
        return { ok: false, error: "Invalid category." };
      }
      if (RECLASSIFY_CATEGORIES.has(item.category)) {
        const kind = row.transaction_kind;
        if (!["income", "expense", "transfer"].includes(kind)) {
          return { ok: false, error: `Cannot write ${item.category} on a ${kind} row.` };
        }
        const pAmount = kind === "transfer" ? Number(row.amount) : Math.abs(Number(row.amount));
        if (!Number.isFinite(pAmount) || pAmount === 0) {
          return { ok: false, error: "Row amount is not usable." };
        }
        const { error } = await supabaseClient.rpc("reclassify_transaction_financial_event", {
          p_owner_id: ownerId,
          p_event_id: item.eventId,
          p_transaction_kind: kind,
          p_normalized_category: item.category,
          p_amount: pAmount,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      }
      const { error } = await supabaseClient.rpc("categorize_financial_event", {
        p_owner_id: ownerId,
        p_event_id: item.eventId,
        p_normalized_category: item.category,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    if (item.kind === "mark_transfer") {
      const row = context.rowsById.get(item.eventId);
      if (!isUnresolvedRow(row)) {
        return { ok: false, error: "Row is already categorized or no longer exists." };
      }
      const signed = Number(row.amount);
      if (!Number.isFinite(signed) || signed === 0) {
        return { ok: false, error: "A transfer leg needs a non-zero amount." };
      }
      const { error } = await supabaseClient.rpc("reclassify_transaction_financial_event", {
        p_owner_id: ownerId,
        p_event_id: item.eventId,
        p_transaction_kind: "transfer",
        p_normalized_category: "internal_transfer",
        p_amount: signed,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    if (item.kind === "dismiss_anomaly") {
      const stillActive = context.alerts.some((alert) => alert.key === item.alertKey);
      if (!stillActive) {
        return { ok: false, error: "Alert is no longer active." };
      }
      const { error } = await supabaseClient.from("dismissed_brain_alerts").upsert(
        { owner_id: ownerId, alert_key: item.alertKey },
        { onConflict: "owner_id,alert_key", ignoreDuplicates: true },
      );
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    return { ok: false, error: `Unknown action kind: ${item.kind}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Apply failed." };
  }
}

// Stage 1: { command } -> plan (nothing is written).
// Stage 2: { planItems, confirmation, command? } -> validated + gated apply.
// When command is present, the plan is recomputed and the client's items must
// match it exactly -- the server never applies client-invented mutations.
export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const context = await assembleActionContext(
      authenticated.supabaseClient,
      authenticated.effectiveOwnerId,
    );

    // ---- Stage 1: plan ----
    if (typeof body?.command === "string" && !Array.isArray(body?.planItems)) {
      const parsed = parseActionCommand(body.command);
      if (parsed.unparseable) {
        return NextResponse.json({
          success: true,
          data: { plan: null, unparseable: true, hint: parsed.hint, gate: "none" },
        });
      }
      const plan = buildActionPlan({
        parsed,
        ambiguousRows: context.ambiguousRows,
        anomalyAlerts: context.alerts,
      });
      return planResponse(plan);
    }

    // ---- Stage 2: apply ----
    const planItems = body?.planItems;
    if (!Array.isArray(planItems) || planItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "planItems must be a non-empty array, or send { command } to plan." },
        { status: 400 },
      );
    }

    let authoritativeItems;
    if (typeof body?.command === "string") {
      const parsed = parseActionCommand(body.command);
      if (parsed.unparseable) {
        return NextResponse.json({ success: false, error: parsed.hint }, { status: 400 });
      }
      const recomputed = buildActionPlan({
        parsed,
        ambiguousRows: context.ambiguousRows,
        anomalyAlerts: context.alerts,
      });
      const recomputedByKey = new Map(recomputed.items.map((item) => [item.itemKey, item]));
      authoritativeItems = [];
      for (const clientItem of planItems) {
        const expected = recomputedByKey.get(clientItem?.itemKey);
        if (
          !expected ||
          expected.kind !== clientItem.kind ||
          (expected.eventId ?? null) !== (clientItem.eventId ?? null) ||
          (expected.alertKey ?? null) !== (clientItem.alertKey ?? null) ||
          (expected.category ?? null) !== (clientItem.category ?? null)
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "The plan changed since you reviewed it. Ask for a fresh plan and confirm again.",
            },
            { status: 409 },
          );
        }
        authoritativeItems.push(expected);
      }
    } else {
      // Explicit items (e.g. the reconciliation panel's per-row apply): the
      // user picked exact rows, so confidence is maximal -- but every item is
      // still revalidated against live data before anything is written.
      const rowById = new Map(context.ambiguousRows.map((row) => [row.eventId, row]));
      const alertByKey = new Map(context.alerts.map((alert) => [alert.key, alert]));
      authoritativeItems = [];
      for (const clientItem of planItems) {
        if (clientItem?.kind === "categorize" && rowById.has(clientItem.eventId)) {
          const row = rowById.get(clientItem.eventId);
          authoritativeItems.push({
            itemKey: `categorize:${clientItem.eventId}`,
            kind: "categorize",
            eventId: clientItem.eventId,
            category: clientItem.category,
            confidence: 1,
            reversible: true,
            summary: `Categorize "${row.description}" as ${String(clientItem.category).replace(/_/g, " ")}`,
          });
        } else if (clientItem?.kind === "mark_transfer" && rowById.has(clientItem.eventId)) {
          const row = rowById.get(clientItem.eventId);
          authoritativeItems.push({
            itemKey: `mark_transfer:${clientItem.eventId}`,
            kind: "mark_transfer",
            eventId: clientItem.eventId,
            confidence: 0.9,
            reversible: true,
            summary: `Mark "${row.description}" as an internal transfer`,
          });
        } else if (clientItem?.kind === "dismiss_anomaly" && alertByKey.has(clientItem.alertKey)) {
          const alert = alertByKey.get(clientItem.alertKey);
          authoritativeItems.push({
            itemKey: `dismiss_anomaly:${clientItem.alertKey}`,
            kind: "dismiss_anomaly",
            alertKey: clientItem.alertKey,
            confidence: 1,
            reversible: true,
            summary: `Dismiss ${alert.severity} alert: ${alert.title}`,
          });
        } else {
          return NextResponse.json(
            {
              success: false,
              error: "One or more items no longer match the books. Refresh and try again.",
            },
            { status: 409 },
          );
        }
      }
    }

    const plan = {
      items: authoritativeItems,
      requiresTypedConfirm: authoritativeItems.some((item) => item.confidence < 0.8),
    };
    if (!confirmationSatisfiesGate(plan, body?.confirmation)) {
      const required = requiredConfirmationForPlan(plan);
      return NextResponse.json(
        {
          success: false,
          error:
            required === "typed"
              ? "Type CONFIRM to apply this plan -- some matches are uncertain."
              : "Confirm this plan before it is applied.",
          requiredGate: required,
        },
        { status: 403 },
      );
    }

    const applied = [];
    const failed = [];
    for (const item of authoritativeItems) {
      const result = await applyItem(
        authenticated.supabaseClient,
        authenticated.effectiveOwnerId,
        item,
        context,
      );
      if (result.ok) applied.push({ itemKey: item.itemKey, kind: item.kind, summary: item.summary });
      else failed.push({ itemKey: item.itemKey, kind: item.kind, error: result.error });
    }

    return NextResponse.json({
      success: failed.length === 0,
      appliedCount: applied.length,
      failedCount: failed.length,
      applied,
      failed,
    });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) {
      return NextResponse.json(
        { error: "Conversational actions aren't available yet.", code: "actions_schema_unavailable" },
        { status: 503 },
      );
    }
    console.error("Financial actions error", error);
    return NextResponse.json({ error: "Unable to process that action." }, { status: 500 });
  }
}
