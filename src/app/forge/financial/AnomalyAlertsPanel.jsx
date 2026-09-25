"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { money } from "./formatMoney.js";

const SEVERITY_STYLES = {
  high: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  medium: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  low: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60",
};

const SEVERITY_BADGE = {
  high: "bg-red-600 text-white",
  medium: "bg-amber-500 text-slate-950",
  low: "bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100",
};

function evidenceLine(alert) {
  const evidence = alert?.evidence ?? {};
  switch (alert?.type) {
    case "spend-spike":
      return `Baseline ${money(evidence.baselineMean)}/mo (σ ${money(evidence.baselineStd)}) · last 30 days ${money(evidence.trailing30Days)}${evidence.multiple != null ? ` · ${evidence.multiple.toFixed(1)}x` : ""}`;
    case "duplicate":
      return `Charged ${money(evidence.amount)} on ${(evidence.dates ?? []).join(" and ")}`;
    case "recurring-drift":
      return `Median ${money(evidence.medianAmount)} → latest ${money(evidence.latestAmount)} (${evidence.pctChange}%${evidence.cadence ? `, ${evidence.cadence}` : ""})`;
    case "new-payee":
      return `${money(evidence.amount)} on ${evidence.date ?? "unknown date"}`;
    default:
      return null;
  }
}

async function scanAnomalies() {
  const response = await fetch("/api/financial/anomalies");
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || "Could not scan for anomalies.");
  }
  return payload.data.alerts ?? [];
}

export default function AnomalyAlertsPanel() {
  const [collapsed, setCollapsed] = useState(false);
  // Stale-while-revalidate: the cached alert list renders instantly on return visits; a
  // background refresh keeps the old list on screen with only the subtle indicator flipping.
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "financial:anomalies",
    scanAnomalies,
    { ttlMs: 60_000 },
  );
  const alerts = data ?? null;

  return (
    <section
      data-anomaly-alerts
      className={forgeTheme.card}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>
            Forge Brain
          </span>

          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Anomaly alerts
          </h2>
        </span>

        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Spend spikes, possible duplicate charges, recurring payments that
            changed amount, and first-time large payees — read-only, nothing
            here moves money.
          </p>

          <div className="mt-4">
            {!alerts && isLoading && <ForgeLoadingState label="Scanning the books…" />}

            {!alerts && !isLoading && error && (
              <ForgeErrorState
                title="Could not scan for anomalies."
                detail={error}
                onRetry={refresh}
              />
            )}

            {alerts && error && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Could not refresh — showing the last saved scan.
              </p>
            )}

            {alerts && isRefreshing && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Updating…
              </p>
            )}

            {alerts && alerts.length === 0 && (
              <ForgeEmptyState
                headline="No anomalies detected"
                guidance="Spend spikes, possible duplicate charges, recurring payments that changed amount, and first-time large payees will show up here."
              />
            )}

            {alerts && alerts.length > 0 && (
              <ul className="flex flex-col gap-2">
                {alerts.map((alert, index) => (
                  <li
                    key={`${alert.type}-${index}`}
                    className={`rounded-xl border px-4 py-3 ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.low}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {alert.title}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold uppercase ${SEVERITY_BADGE[alert.severity] ?? SEVERITY_BADGE.low}`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {alert.detail}
                    </p>
                    {evidenceLine(alert) && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                        {evidenceLine(alert)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
