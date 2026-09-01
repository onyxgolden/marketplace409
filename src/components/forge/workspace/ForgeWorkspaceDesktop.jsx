import { Fragment } from "react";

import ForgeInformationCenter from "@/components/forge/workspace/ForgeInformationCenter";
import { createWorkspaceRegistry } from "@/components/forge/workspace/composition/createWorkspaceRegistry";

const workspaceRegistry =
  createWorkspaceRegistry();

export default function ForgeWorkspaceDesktop({
  netWorth,
  riskSummary,
  riskAssessment,
  executiveBriefing,
  auditFindings,
  alertItems,
  insightItems,
  portfolioSummaryItems,
  systemHealthItems,
  systemStatusItems,
  recentActivities,
  formatCurrency,
  financialKpiModel,
  financialExecutiveSummary,
  setView,
  ownerId,
  properties,
  transactionReview,
}) {
  const workspaceContext = {
    netWorth,
    riskSummary,
    riskAssessment,
    executiveBriefing,
    insightItems,
    auditFindings,
    portfolioSummaryItems,
    systemHealthItems,
    systemStatusItems,
    formatCurrency,
    financialKpiModel,
    financialExecutiveSummary,
    ownerId,
    properties,
    transactionReview,
  };

  return (
    <section>
      <header className="mb-6 rounded-3xl border border-slate-800 bg-slate-950 px-6 py-5 text-white shadow-lg lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-400">
              FORGE Workspace
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight">
              Choose an application
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 lg:text-base">
              Review current operating signals, then open the application that owns the work.
            </p>
          </div>

          <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-5 py-3">
            <div className="text-xs font-black uppercase tracking-wide text-slate-300">
              Current risk
            </div>

            <div className="mt-1 text-2xl font-black text-amber-400">
              {riskSummary?.severity ?? "Unknown"}
            </div>

            <div className="text-sm text-slate-300">
              Score {riskSummary?.score ?? 0}
            </div>
          </div>
        </div>
      </header>

      <details
        data-workspace-information-center
        className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-sm font-black text-slate-950 dark:text-slate-50">
              Information center
            </div>

            <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Alerts, insights, activity, and quick actions
            </div>
          </div>

          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {(alertItems || []).length} alerts
          </div>
        </summary>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <ForgeInformationCenter
            alerts={alertItems}
            insights={insightItems}
            recentActivities={
              recentActivities
            }
            setView={setView}
          />
        </div>
      </details>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {workspaceRegistry
          .list()
          .map((workspaceModule) => (
            <Fragment
              key={
                workspaceModule.moduleIdentity
              }
            >
              {workspaceModule.renderTile(
                workspaceContext,
              )}
            </Fragment>
          ))}
      </div>
    </section>
  );
}
