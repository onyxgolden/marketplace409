"use client";

import { useMemo, useState } from "react";

import ForgeDashboardShell from "@/components/forge/ForgeDashboardShell";
import { ForgeDashboardApplication } from "@/application";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

export default function ForgeDashboardClient({
  initialDashboardIntelligence,
  initialReadModels,
}) {
  const [view, setView] = useState("dashboard");

  const [dashboardIntelligence] = useState(initialDashboardIntelligence);

  const [readModels] = useState(initialReadModels);

  const dashboardViewModel = useMemo(
    () => ForgeDashboardApplication.buildViewModel(dashboardIntelligence),
    [dashboardIntelligence],
  );

  return (
    <>
      <ForgeDashboardShell
        view={view}
        setView={setView}
        netWorth={dashboardViewModel.netWorth}
        riskSummary={dashboardViewModel.riskSummary}
        riskAssessment={dashboardViewModel.riskAssessment}
        executiveBriefing={dashboardViewModel.executiveBriefing}
        auditFindings={dashboardViewModel.auditFindings}
        alertItems={dashboardViewModel.alertItems}
        insightItems={dashboardViewModel.insightItems}
        portfolioSummaryItems={dashboardViewModel.portfolioSummaryItems}
        systemHealthItems={dashboardViewModel.systemHealthItems}
        systemStatusItems={dashboardViewModel.systemStatusItems}
        recentActivities={dashboardViewModel.recentActivities}
        formatCurrency={formatCurrency}
        financialKpiModel={readModels.kpiModel}
        financialExecutiveSummary={
          readModels.executiveSummary
        }
        ownerId={readModels.ownerId}
        properties={readModels.workspace?.properties || []}
        transactionReview={readModels.transactionReview}
      />

      {readModels && (
        <section className="mx-auto mt-8 max-w-[1600px] px-4 pb-8 lg:px-8">
          <details className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Read Model Diagnostic Layer
            </summary>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <pre className="overflow-auto rounded-2xl bg-slate-100 dark:bg-slate-800 dark:text-slate-300 p-4 text-xs">
                {JSON.stringify(readModels.businessDashboard, null, 2)}
              </pre>
              <pre className="overflow-auto rounded-2xl bg-slate-100 dark:bg-slate-800 dark:text-slate-300 p-4 text-xs">
                {JSON.stringify(readModels.investorDashboard, null, 2)}
              </pre>
              <pre className="overflow-auto rounded-2xl bg-slate-100 dark:bg-slate-800 dark:text-slate-300 p-4 text-xs">
                {JSON.stringify(readModels.kpiModel, null, 2)}
              </pre>
              <pre className="overflow-auto rounded-2xl bg-slate-100 dark:bg-slate-800 dark:text-slate-300 p-4 text-xs">
                {JSON.stringify(readModels.executiveSummary, null, 2)}
              </pre>
            </div>
          </details>
        </section>
      )}
    </>
  );
}
