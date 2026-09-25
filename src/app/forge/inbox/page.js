"use client";

import { useCallback, useMemo, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { forgeTheme } from "@/components/forge/theme";
import {
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import {
  ForgeActionButton,
  ForgeActionLink,
  ForgeActionStack,
} from "@/components/forge/ForgeActions";
import { buildMorningQueue } from "@/domains/ledger/brain/morningQueue.js";
import { buildBrainDigest } from "@/domains/ledger/brain/digest.js";
import { lineVarianceCents } from "@/domains/budgeting/budgetVariance.js";

const BILL_HORIZON_DAYS = 14;
const CONFIDENCE_GATE = 0.8;

const KIND_LABEL = {
  uncategorized: "Uncategorized",
  anomaly: "Anomaly",
  bill: "Bill",
  overrun: "Overrun",
};

const SEVERITY_BADGE = {
  high: "bg-red-600 text-white",
  medium: "bg-amber-500 text-slate-950",
  low: "bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100",
};

const SEVERITY_CARD = {
  high: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  medium: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  low: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
};

function chicagoToday() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
    .slice(0, 10);
}

function addDaysIso(dateOnly, days) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `Request failed: ${url}`);
  }
  return payload;
}

// Fetches every morning-queue source independently. A failed source is
// recorded, not thrown, so one bad endpoint can't blank the queue; only when
// every source fails does the fetcher throw (and the shared hook keeps the
// last good bundle on screen either way).
async function fetchInboxSources(month) {
  const jobs = {
    transfers: fetchJson("/api/financial/reconcile-transfers"),
    anomalies: fetchJson("/api/financial/anomalies"),
    recurring: fetchJson("/api/financial/recurring"),
    budgetPersonal: fetchJson(`/api/budgeting/plan?month=${month}&scope=personal`),
    budgetBusiness: fetchJson(`/api/budgeting/plan?month=${month}&scope=business`),
    forecast: fetchJson("/api/financial/forecast?days=90"),
    // The debt-payoff API suppresses topMove when the owner's suggestions
    // preference is off, so this stays silent for opted-out owners.
    debtPayoff: fetchJson("/api/financial/debt-payoff?monthlySurplus=500"),
  };
  const entries = await Promise.all(
    Object.entries(jobs).map(async ([name, promise]) => {
      try {
        return [name, await promise, null];
      } catch (error) {
        return [name, null, error instanceof Error ? error.message : "Failed to load."];
      }
    }),
  );
  const data = {};
  const failed = [];
  for (const [name, payload, error] of entries) {
    if (error) failed.push(name);
    else data[name] = payload;
  }
  if (Object.keys(data).length === 0) {
    throw new Error(`${failed.join(", ")} failed — try reloading.`);
  }
  return { data, failed };
}

function upcomingBills(patterns, today) {
  const horizon = addDaysIso(today, BILL_HORIZON_DAYS);
  return (patterns ?? [])
    .filter((pattern) => pattern?.direction === "outbound")
    .filter((pattern) => {
      const date = String(pattern?.nextExpectedDate ?? "").slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && date <= horizon;
    })
    .map((pattern) => ({
      accountName: pattern?.accountName ?? null,
      category: pattern?.category ?? null,
      cadence: pattern?.cadence ?? null,
      medianAmount: Number(pattern?.medianAmount) || 0,
      nextExpectedDate: String(pattern.nextExpectedDate).slice(0, 10),
    }));
}

function overrunsFromPlan(lines, month, scope) {
  return (lines ?? [])
    .map((line) => {
      const variance = lineVarianceCents({
        plannedAmountCents: line?.plannedAmountCents ?? null,
        actualAmountCents: line?.actualAmountCents ?? 0,
      });
      if (variance == null || variance >= 0) return null;
      return {
        label: line?.displayLabel ?? line?.normalizedCategory ?? "Budget line",
        overAmountCents: -variance,
        month,
        scope,
      };
    })
    .filter(Boolean);
}

function QueueItemCard({ item, onResolve, applyState, confirmState, onConfirmChange }) {
  const state = applyState[item.id] ?? { status: "idle", message: "" };
  const busy = state.status === "applying";
  const needsTypedConfirm =
    item.kind === "uncategorized" &&
    (item.payload.suggestionConfidence ?? 1) < CONFIDENCE_GATE;

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${SEVERITY_CARD[item.severity] ?? SEVERITY_CARD.low}`}
      data-queue-item={item.id}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.low}`}>
              {item.severity}
            </span>
            <span className={forgeTheme.labelSmall}>{KIND_LABEL[item.kind]}</span>
          </div>
          <p className="mt-1 text-sm font-black text-slate-950 dark:text-slate-50">
            {item.title}
          </p>
          {item.detail && (
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              {item.detail}
            </p>
          )}
          {state.status === "error" && state.message && (
            <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">
              {state.message}
            </p>
          )}
        </div>

        <ForgeActionStack>
          {item.kind === "uncategorized" && item.payload.suggestionCategory && (
            <>
              {!needsTypedConfirm || confirmState[item.id]?.armed ? (
                <>
                  {needsTypedConfirm && (
                    <input
                      value={confirmState[item.id]?.text ?? ""}
                      onChange={(event) => onConfirmChange(item.id, event.target.value)}
                      placeholder='Type CONFIRM'
                      aria-label="Type CONFIRM to apply a low-confidence suggestion"
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-800"
                    />
                  )}
                  <ForgeActionButton
                    variant="primary"
                    disabled={busy || (needsTypedConfirm && (confirmState[item.id]?.text ?? "").trim().toUpperCase() !== "CONFIRM")}
                    onClick={() => onResolve(item, needsTypedConfirm ? "CONFIRM" : "SINGLE")}
                  >
                    {busy ? "Applying…" : `Apply: ${item.payload.suggestionCategory.replace(/_/g, " ")}`}
                  </ForgeActionButton>
                </>
              ) : (
                <ForgeActionButton
                  onClick={() => onConfirmChange(item.id, "", true)}
                >
                  Review suggestion
                </ForgeActionButton>
              )}
            </>
          )}
          {item.kind === "uncategorized" && !item.payload.suggestionCategory && (
            <ForgeActionLink href={item.pointer}>
              Review
            </ForgeActionLink>
          )}
          {item.kind === "anomaly" && (
            <ForgeActionButton
              disabled={busy}
              onClick={() => onResolve(item, "SINGLE")}
            >
              {busy ? "Dismissing…" : "Dismiss"}
            </ForgeActionButton>
          )}
          {(item.kind === "bill" || item.kind === "overrun") && (
            <ForgeActionButton onClick={() => onResolve(item, "ACK")}>
              Mark reviewed
            </ForgeActionButton>
          )}
        </ForgeActionStack>
      </div>
    </li>
  );
}

export default function InboxPage() {
  // Morning queue sources: stale-while-revalidate. Each source is fetched
  // independently so one failing endpoint can't blank the whole queue; the
  // fetcher only throws when every source failed, which keeps the last good
  // queue on screen while a refresh is in flight.
  const today = chicagoToday();
  const month = today.slice(0, 7);
  const {
    data: bundle,
    error: loadError,
    isLoading,
    isRefreshing,
    refresh,
  } = useStaleWhileRevalidate(
    `forge:inbox-sources:${month}`,
    () => fetchInboxSources(month),
    { ttlMs: 60_000 },
  );
  const sources = bundle?.data ?? null;
  const failedSources = bundle?.failed ?? [];
  const [resolvedIds, setResolvedIds] = useState(() => new Set());
  const [applyState, setApplyState] = useState({});
  const [confirmState, setConfirmState] = useState({});

  const derived = useMemo(() => {
    if (!sources) return null;
    const ambiguousRows = sources.transfers?.ambiguousTransfers ?? [];
    const alerts = sources.anomalies?.data?.alerts ?? [];
    const bills = upcomingBills(sources.recurring?.patterns, today);
    const overruns = [
      ...overrunsFromPlan(sources.budgetPersonal?.lines, month, "personal"),
      ...overrunsFromPlan(sources.budgetBusiness?.lines, month, "business"),
    ];
    const queue = buildMorningQueue({ ambiguousRows, alerts, bills, overruns, now: new Date() });
    const forecastWarnings = sources.forecast?.data?.warnings ?? [];
    const digest = buildBrainDigest({
      anomalies: alerts,
      forecast: { warnings: forecastWarnings },
      pendingSuggestions: ambiguousRows.length,
      budgetOverruns: overruns,
      debtTopMove: sources.debtPayoff?.data?.topMove ?? null,
      now: new Date(),
    });
    return { queue, digest };
  }, [sources, today, month]);

  const openItems = useMemo(() => {
    if (!derived) return [];
    return derived.queue.items.filter((item) => !resolvedIds.has(item.id));
  }, [derived, resolvedIds]);

  const markResolved = useCallback((id) => {
    setResolvedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const resolveItem = useCallback(
    async (item, confirmation) => {
      if (confirmation === "ACK") {
        // Local-only: acknowledging a bill or overrun marks it reviewed in
        // this queue. It does not pay the bill or change the budget.
        markResolved(item.id);
        return;
      }
      setApplyState((prev) => ({ ...prev, [item.id]: { status: "applying", message: "" } }));
      try {
        const planItems =
          item.kind === "anomaly"
            ? [{ kind: "dismiss_anomaly", alertKey: item.payload.alertKey }]
            : [
                {
                  kind: "categorize",
                  eventId: item.payload.eventId,
                  category: item.payload.suggestionCategory,
                },
              ];
        const response = await fetch("/api/financial/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planItems, confirmation }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not apply that change.");
        }
        markResolved(item.id);
        setApplyState((prev) => ({ ...prev, [item.id]: { status: "done", message: "" } }));
        setConfirmState((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } catch (error) {
        setApplyState((prev) => ({
          ...prev,
          [item.id]: {
            status: "error",
            message: error instanceof Error ? error.message : "Could not apply that change.",
          },
        }));
      }
    },
    [markResolved],
  );

  const handleConfirmChange = useCallback((id, text, armed = false) => {
    setConfirmState((prev) => ({
      ...prev,
      [id]: { text, armed: armed || prev[id]?.armed || false },
    }));
  }, []);

  const allFailed = !isLoading && !sources && loadError;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={forgeTheme.labelSmall}>Forge Brain</p>
          <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-slate-50">
            Morning queue
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Uncategorized first, then anomalies, bills, and budget overruns.
            Clear it and the day is yours.
          </p>
        </div>
        <div className="text-right">
          <div className="text-5xl font-black text-slate-950 dark:text-slate-50" data-queue-count>
            {derived ? openItems.length : "–"}
          </div>
          <div className={forgeTheme.labelSmall}>open items</div>
          {isRefreshing ? (
            <div className="mt-1 text-xs font-bold text-slate-400">Updating…</div>
          ) : null}
          {sources && loadError ? (
            <div className="mt-1 text-xs font-bold text-slate-400" role="status">
              Could not refresh — showing the last saved queue.
            </div>
          ) : null}
        </div>
      </header>

      {isLoading && (
        <div className="mt-6">
          <ForgeLoadingState label="Loading your queue…" />
        </div>
      )}

      {!isLoading && allFailed && (
        <div className="mt-6">
          <ForgeErrorState
            title="Couldn't load the queue."
            detail={loadError || "Try reloading."}
            onRetry={refresh}
            retryLabel="Reload"
          />
        </div>
      )}

      {!isLoading && !allFailed && derived && (
        <>
          {failedSources.length > 0 && (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Some sections didn&apos;t load ({failedSources.join(", ")}). What&apos;s
              below is partial.
            </p>
          )}

          <section className={`mt-6 ${forgeTheme.card}`} data-brain-digest>
            <p className={forgeTheme.labelSmall}>Brain digest</p>
            {derived.digest.items.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                All quiet — no shortfalls, anomalies, or overruns this morning.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {derived.digest.items.map((digestItem, index) => (
                  <li
                    key={`${digestItem.kind}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${SEVERITY_BADGE[digestItem.severity] ?? SEVERITY_BADGE.low}`}
                    >
                      {digestItem.severity}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-200">
                      {digestItem.summary}
                    </span>
                    <ForgeActionLink href={digestItem.pointer} inline>
                      Open
                    </ForgeActionLink>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6" aria-label="Work queue">
            {openItems.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <p className="text-lg font-black text-emerald-900 dark:text-emerald-200">
                  Queue clear — nothing needs you.
                </p>
                <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                  Zero open decisions. The books are quiet.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {openItems.map((item) => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    onResolve={resolveItem}
                    applyState={applyState}
                    confirmState={confirmState}
                    onConfirmChange={handleConfirmChange}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 text-xs text-slate-500 dark:text-slate-500">
            Bills and overruns marked reviewed stay as they are — marking one
            reviewed doesn&apos;t pay it or change your budget. Categorizations
            and dismissals write through the Brain&apos;s gated actions and can
            be reversed.
          </p>
        </>
      )}
    </main>
  );
}
