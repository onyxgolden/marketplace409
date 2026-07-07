"use client";

import { useEffect, useMemo, useState } from "react";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import { forgeTheme } from "@/components/forge/theme";

function cents(value) {
  return Number(value || 0);
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents(value) / 100);
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export default function FinancialPage() {
  const [dashboard, setDashboard] = useState(null);
  const [operationsPlan, setOperationsPlan] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/financial/snapshot");
        const payload = await response.json();

        if (!payload.success) {
          throw new Error(payload.error || "Financial snapshot failed.");
        }

        const operationsResponse = await fetch("/api/financial/operations");
        const operationsPayload = await operationsResponse.json();

        if (!operationsPayload.success) {
          throw new Error(
            operationsPayload.error || "Financial operations failed.",
          );
        }

        setDashboard(payload.data?.dashboard || null);
        setOperationsPlan(operationsPayload.data || null);
        setLoadState("ready");
      } catch (loadError) {
        setError(loadError.message);
        setLoadState("error");
      }
    }

    load();
  }, []);

  const kpis = dashboard?.kpis || {};
  const health = dashboard?.health || {
    label: "Loading",
    detail: "Financial dashboard data is loading.",
  };
  const metadata = dashboard?.metadata || {};
  const balanceSheetLines = dashboard?.balanceSheetLines || [];

  const statusItems = useMemo(
    () => [
      {
        label: "Financial Engine",
        detail: "Reports are generated through the ledger domain engine.",
        value: loadState === "ready" ? "online" : loadState,
      },
      {
        label: "Data Provider",
        detail: "Provider abstraction is active for Phase 7.3.",
        value: metadata.provider || "pending",
      },
      {
        label: "Snapshot Status",
        detail: "Live persistence and sync history are deferred.",
        value: metadata.snapshotStatus || "pending",
      },
    ],
    [loadState, metadata.provider, metadata.snapshotStatus],
  );

  const activities = [
    {
      id: "dashboard-built",
      label: "Dashboard DTO generated",
      detail: "KPIs, health status, and statement lines are supplied by the domain service.",
      type: "domain",
      timestamp: "Current session",
    },
    {
      id: "provider-active",
      label: "Provider abstraction active",
      detail: "Dashboard is reading through the financial API boundary.",
      type: "provider",
      timestamp: `Phase ${metadata.phase || "7.3"}`,
    },
    {
      id: "operations-api",
      label: "Operations plan connected",
      detail: "Financial operations guidance is supplied through the operations API.",
      type: "application",
      timestamp: "Phase 13.2",
    },
    {
      id: "imports-deferred",
      label: "External imports deferred",
      detail: "Rental, Plaid, brokerage, Stripe, and valuation feeds remain sequenced after dashboard stabilization.",
      type: "roadmap",
      timestamp: "Planned",
    },
  ];

  return (
    <div className={forgeTheme.page}>
      <main className="mx-auto min-h-screen max-w-[1600px] space-y-6 p-4 lg:p-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className={forgeTheme.labelSmall}>FORGE Financial Command</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
                Executive KPI Dashboard
              </h1>
              <p className="mt-3 max-w-3xl text-slate-600">
                Financial performance, cash position, equity, and operating margin
                surfaced from the FORGE financial engine and dashboard domain service.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="text-xs font-black uppercase tracking-wide text-amber-700">
                Health Status
              </div>
              <div className="mt-1 text-2xl font-black text-amber-950">
                {health.label}
              </div>
              <div className="mt-1 max-w-xs text-sm text-amber-800">
                {health.detail}
              </div>
            </div>
          </div>
        </section>

        {loadState === "error" && (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
            <div className="font-black">Financial dashboard failed to load.</div>
            <div className="mt-2 text-sm">{error}</div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ForgeDashboardCard
            label="Net Worth / Equity"
            value={money(kpis.equity)}
            detail={`Assets ${money(kpis.assets)} · Liabilities ${money(kpis.liabilities)}`}
          />
          <ForgeDashboardCard
            label="Cash"
            value={money(kpis.cash)}
            detail={`Receivables ${money(kpis.receivables)}`}
          />
          <ForgeDashboardCard
            label="Monthly Profit"
            value={money(kpis.profit)}
            detail={`Revenue ${money(kpis.revenue)} · Expenses ${money(kpis.expenses)}`}
          />
          <ForgeDashboardCard
            label="Profit Margin"
            value={percent(kpis.margin)}
            detail="Revenue retained after expenses"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <section className={forgeTheme.card}>
              <div className={forgeTheme.labelSmall}>Financial Statement</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                Balance Sheet Snapshot
              </h2>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-4">Account</th>
                      <th className="p-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {balanceSheetLines.map((line) => (
                      <tr key={line.accountId}>
                        <td className="p-4 font-bold text-slate-800">
                          {line.accountName}
                        </td>
                        <td className="p-4 text-right font-black text-slate-950">
                          {money(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={forgeTheme.card}>
              <div className={forgeTheme.labelSmall}>Trend Area</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                Historical Trends Reserved
              </h2>
              <div className="mt-5 rounded-2xl bg-slate-100 p-5">
                <div className="text-sm text-slate-600">
                  Net worth, cash, revenue, and expense history will appear here
                  after snapshot persistence is introduced.
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  {["Net Worth", "Cash", "Revenue", "Expenses"].map((item) => (
                    <div key={item} className="rounded-2xl bg-white p-4">
                      <div className={forgeTheme.labelSmall}>{item}</div>
                      <div className="mt-3 h-2 rounded-full bg-slate-200">
                        <div className="h-2 w-2/3 rounded-full bg-slate-700" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <ForgeSystemStatus statusItems={statusItems} />
            <ForgeRecentActivity activities={activities} />

            <section className={forgeTheme.cardCompact}>
              <div className={forgeTheme.labelSmall}>Financial Operations</div>
              <h2 className="mt-2 text-xl font-black text-slate-950">
                {operationsPlan?.focus || "Operations Plan"}
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                {operationsPlan?.summary ||
                  "Financial operations guidance is loading."}
              </p>

              <div className="mt-4 rounded-2xl bg-slate-100 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Priority
                </div>
                <div className="mt-1 text-lg font-black capitalize text-slate-950">
                  {operationsPlan?.priority || "monitor"}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(operationsPlan?.actions || []).slice(0, 3).map((action) => (
                  <div
                    key={action.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="font-black text-slate-900">
                      {action.title}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                      {action.status} · {action.priority}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {action.rationale}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={forgeTheme.cardCompact}>
              <div className={forgeTheme.labelSmall}>Phase Guardrails</div>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <p>Rental portfolio import remains deferred until this dashboard is stable.</p>
                <p>Plaid, brokerage, valuation, and Stripe integrations remain behind the provider boundary.</p>
                <p>Financial calculations stay in the domain layer, not React components.</p>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
