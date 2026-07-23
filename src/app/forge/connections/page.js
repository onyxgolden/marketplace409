"use client";

import { useEffect, useState } from "react";
import { ForgeConnectionDashboardApplication } from "@/application/connection";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import { forgeTheme } from "@/components/forge/theme";

export default function ConnectionPage() {
  const [viewModel, setViewModel] = useState(
    ForgeConnectionDashboardApplication.buildLoadingModel(),
  );

  useEffect(() => {
    async function load() {
      const result =
        await ForgeConnectionDashboardApplication.load();

      setViewModel(result);
    }

    load();
  }, []);

  const {
    loadState,
    error,
    summary,
    connections,
    statusItems,
    activities,
    metadata,
  } = viewModel;

  return (
    <div className={forgeTheme.page}>
      <main className="mx-auto min-h-screen max-w-[1600px] space-y-6 p-4 lg:p-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className={forgeTheme.labelSmall}>FORGE Connection Command</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
                Connection Platform Dashboard
              </h1>
              <p className="mt-3 max-w-3xl text-slate-600">
                Monitor authenticated financial connections, institution references,
                provider capabilities, and import readiness.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="text-xs font-black uppercase tracking-wide text-amber-700">
                Platform State
              </div>
              <div className="mt-1 text-2xl font-black text-amber-950">
                {summary?.health?.label || loadState}
              </div>
              <div className="mt-1 max-w-xs text-sm text-amber-800">
                {summary?.health?.detail ||
                  "Loading connection platform status."}
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6">
            <div className="text-xs font-black uppercase tracking-wide text-red-700">
              Connection Dashboard Error
            </div>
            <div className="mt-2 text-lg font-bold text-red-950">
              {error.message || String(error)}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ForgeDashboardCard
            label="Connections"
            value={summary?.connectionCount ?? connections.length}
            detail="Authenticated provider connections"
          />
          <ForgeDashboardCard
            label="Institutions"
            value={summary?.institutionCount ?? 0}
            detail="Referenced financial institutions"
          />
          <ForgeDashboardCard
            label="Ready for Import"
            value={summary?.readyForImportCount ?? 0}
            detail="Connections available for financial import"
          />
          <ForgeDashboardCard
            label="Provider"
            value={summary?.provider || metadata?.provider || "Not available"}
            detail="Active connection provider"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className={forgeTheme.labelSmall}>Connection Inventory</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Authenticated Connections
            </h2>

            <div className="mt-6 space-y-4">
              {connections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                  No connection records are available yet.
                </div>
              ) : (
                connections.map((connection, index) => (
                  <article
                    key={connection.id || `${connection.provider}-${index}`}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                      <div>
                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                          {connection.provider || "Connection Provider"}
                        </div>
                        <h3 className="mt-1 text-xl font-black text-slate-950">
                          {connection.institution?.name ||
                            connection.institutionName ||
                            "Financial Institution"}
                        </h3>
                        <div className="mt-2 text-sm text-slate-600">
                          Status: {connection.status || "unknown"}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-800">
                        {connection.readyForImport
                          ? "Ready for import"
                          : "Import not ready"}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <ForgeSystemStatus
            title="Connection Platform Status"
            items={statusItems}
          />
        </section>

        <ForgeRecentActivity
          title="Recent Connection Activity"
          activities={activities}
        />
      </main>
    </div>
  );
}
