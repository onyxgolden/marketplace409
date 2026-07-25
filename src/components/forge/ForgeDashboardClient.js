"use client";

import { useEffect, useMemo, useState } from "react";

import ForgeDashboardShell from "@/components/forge/ForgeDashboardShell";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

export default function ForgeDashboardClient({
  forgeDashboardApplication,
}) {
  const [view, setView] = useState("networth");

  const [dashboardIntelligence, setDashboardIntelligence] =
    useState(() =>
      forgeDashboardApplication.buildLoadingDashboardIntelligence(),
    );

  const [readModels, setReadModels] = useState(null);

  useEffect(() => {
    let isMounted = true;

    forgeDashboardApplication.loadDashboardIntelligence().then((result) => {
      if (isMounted) {
        setDashboardIntelligence(result);
      }
    });

    forgeDashboardApplication.loadReadModels().then((result) => {
      if (isMounted && result) {
        setReadModels(result);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const dashboardViewModel = useMemo(
    () => forgeDashboardApplication.buildViewModel(dashboardIntelligence),
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
      />

      {readModels && (
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">
            Read Model Shadow Layer (Phase 10)
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <pre className="overflow-auto text-xs">
              {JSON.stringify(readModels.businessDashboard, null, 2)}
            </pre>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(readModels.investorDashboard, null, 2)}
            </pre>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(readModels.kpiModel, null, 2)}
            </pre>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(readModels.executiveSummary, null, 2)}
            </pre>
          </div>
        </section>
      )}
    </>
  );
}
