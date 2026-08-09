"use client";

import { useEffect, useState } from "react";
import { ForgeConnectionDashboardApplication } from "@/application/connection";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import PlaidConnectButton from "@/components/forge/PlaidConnectButton";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import ConnectionExecutionResultCard from "@/components/forge/ConnectionExecutionResultCard";
import { forgeTheme } from "@/components/forge/theme";

export default function ConnectionPage() {
  const [viewModel, setViewModel] = useState(
    ForgeConnectionDashboardApplication.buildLoadingModel(),
  );

  const [executionResult, setExecutionResult] =
    useState(null);

  const [isExecuting, setIsExecuting] =
    useState(false);


  async function executeConnectionOperation(card) {
    setIsExecuting(true);

    try {
      const response =
        await fetch("/api/connection/operations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operation: card.action,
            connectionId: card.connectionId,
          }),
        });

      const payload =
        await response.json();

      if (!payload.success) {
        throw new Error(
          payload.error ||
            "Operation failed.",
        );
      }

      setExecutionResult(
        payload.data,
      );

      await loadDashboard();
    } finally {
      setIsExecuting(false);
    }
  }

  async function loadDashboard() {
    const result =
      await ForgeConnectionDashboardApplication.load();

    setViewModel(result);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const {
    loadState,
    error,
    summary,
    connections,
    statusItems,
    activities,
    metadata,
    health,
    recommendations,
    intelligence,
    workflow,
  } = viewModel;

  const workflowStages =
    workflow?.stages || [];

  const workflowCards =
    workflow?.cards || [];

  const executionReadiness =
    workflow?.executionReadiness || null;

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
                {health?.overall ||
                  loadState}
              </div>
              <div className="mt-1 max-w-xs text-sm text-amber-800">
                {health
                  ? `Health score ${health.score}. ${health.issueCount} issues and ${health.warningCount} warnings.`
                  : "Loading connection platform status."}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <PlaidConnectButton />

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className={forgeTheme.labelSmall}>
              What Happens Next
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              From secure connection to financial insight
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              After you authorize an institution through Plaid, FORGE prepares
              the connection for financial import and review.
            </p>

            <div className="mt-6 space-y-3">
              {[
                "Secure connection established",
                "Authorized accounts discovered",
                "Financial import becomes available",
                "Imported transactions are ready for review",
                "FORGE dashboards begin using authorized financial data",
              ].map((step, index) => (
                <div
                  key={step}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                    {index + 1}
                  </div>
                  <div className="pt-1 text-sm font-bold text-slate-800">
                    {step}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              Once authorization completes, this dashboard refreshes
              automatically and displays the connected institution and import
              readiness.
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6">
            <div className="text-xs font-black uppercase tracking-wide text-red-700">
              Connection Dashboard Error
            </div>
            <div className="mt-2 text-lg font-bold text-red-950">
              {error instanceof Error
                ? error.message
                : String(error)}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ForgeDashboardCard
            label="Connections"
            value={
              summary?.totalConnections ??
              connections.length
            }
            detail="Authenticated provider connections"
          />
          <ForgeDashboardCard
            label="Healthy"
            value={
              summary?.healthyConnections ??
              0
            }
            detail="Connections operating normally"
          />
          <ForgeDashboardCard
            label="Ready for Import"
            value={
              summary?.readyForImportConnections ??
              0
            }
            detail="Connections available for financial import"
          />
          <ForgeDashboardCard
            label="Needs Attention"
            value={
              summary?.requiringAttentionConnections ??
              0
            }
            detail="Connections requiring user action"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className={forgeTheme.labelSmall}>
              Execution Readiness
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Deterministic Workflow
            </h2>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                Workflow State
              </div>
              <div className="mt-2 text-3xl font-black text-slate-950">
                {executionReadiness?.status ||
                  "loading"}
              </div>
              <div className="mt-3 text-sm text-slate-600">
                {executionReadiness
                  ? `${executionReadiness.readyOperations} of ${executionReadiness.totalOperations} operations are ready.`
                  : "Preparing the connection operations workflow."}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Ready
                </div>
                <div className="mt-1 text-2xl font-black text-slate-950">
                  {executionReadiness?.readyOperations ??
                    0}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Blocked
                </div>
                <div className="mt-1 text-2xl font-black text-slate-950">
                  {executionReadiness?.blockedOperations ??
                    0}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Read-only:{" "}
              {workflow?.metadata?.readOnly
                ? "yes"
                : "no"}
              {" · "}
              Deterministic:{" "}
              {workflow?.metadata?.deterministic
                ? "yes"
                : "no"}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className={forgeTheme.labelSmall}>
              Workflow Stages
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Connection Operations Pipeline
            </h2>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {workflowStages.map((stage) => (
                <article
                  key={stage.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                    {stage.status}
                  </div>
                  <h3 className="mt-2 text-lg font-black text-slate-950">
                    {stage.label}
                  </h3>
                  <div className="mt-3 text-3xl font-black text-slate-950">
                    {stage.operationCount}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Operations
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className={forgeTheme.labelSmall}>
            Priority Actions
          </div>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                Connection Operation Queue
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Prioritized, deterministic next steps generated from connection health and import readiness.
              </p>
            </div>

            <div className="text-sm font-bold text-slate-600">
              {recommendations?.length || 0} recommendations
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {workflowCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                No connection operations are currently queued.
              </div>
            ) : (
              workflowCards.map((card, index) => (
                <article
                  key={card.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                        Priority {index + 1} · {card.priority} · {card.stage}
                      </div>
                      <h3 className="mt-2 text-xl font-black text-slate-950">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {card.detail}
                      </p>
                      {card.connectionId ? (
                        <div className="mt-3 text-xs font-bold text-slate-500">
                          Connection: {card.connectionId}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-800">
                      {card.readiness}
                    </div>

                    <button
                      type="button"
                      disabled={
                        isExecuting ||
                        !card.connectionId
                      }
                      onClick={() =>
                        executeConnectionOperation(card)
                      }
                      className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      {isExecuting
                        ? "Executing..."
                        : "Execute"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          {intelligence ? (
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                Ready connections:{" "}
                <strong>
                  {intelligence.readyConnectionIds?.length ||
                    0}
                </strong>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                Attention connections:{" "}
                <strong>
                  {intelligence.attentionConnectionIds?.length ||
                    0}
                </strong>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                Degraded connections:{" "}
                <strong>
                  {intelligence.degradedConnectionIds?.length ||
                    0}
                </strong>
              </div>
            </div>
          ) : null}

          {executionResult?.intelligence ? (
            <div className="mt-6">
              <ConnectionExecutionResultCard
                execution={
                  executionResult.intelligence
                }
              />
            </div>
          ) : null}
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
