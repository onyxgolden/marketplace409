"use client";

import React, { useEffect, useMemo, useState } from "react";
import ForgeDashboardShell from "@/components/forge/ForgeDashboardShell";
import { ForgeDashboardApplication } from "@/application/financial";

export const dynamic = "force-dynamic";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

export default function ForgePage() {
  const [view, setView] = useState("networth");
  const [dashboardIntelligence, setDashboardIntelligence] = useState(() =>
    ForgeDashboardApplication.buildLoadingDashboardIntelligence(),
  );
  const [readModels, setReadModels] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardIntelligence() {
      try {
        const response = await fetch("/api/financial/dashboard-intelligence", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            ForgeDashboardApplication.buildDashboardRequestInput(),
          ),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Unable to load dashboard intelligence.",
          );
        }

        if (isMounted) {
          setDashboardIntelligence(
            ForgeDashboardApplication.normalizeDashboardIntelligence(
              payload.data,
            ),
          );
        }
      } catch (error) {
        if (isMounted) {
          setDashboardIntelligence(
            ForgeDashboardApplication.buildErrorDashboardIntelligence(error),
          );
        }
      }
    }

    async function loadReadModels() {
      try {
        const response = await fetch(
          "/api/financial/read-models?business=true&investor=true&kpi=true&executive=true",
        );

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error ?? "Read models failed.");
        }

        if (isMounted) {
          setReadModels(payload.data);
        }
      } catch (error) {
        console.warn("Read models failed (non-blocking):", error);
      }
    }

    loadDashboardIntelligence();
    loadReadModels();

    return () => {
      isMounted = false;
    };
  }, []);

  const dashboardViewModel = useMemo(
    () => ForgeDashboardApplication.buildViewModel(dashboardIntelligence),
    [dashboardIntelligence],
  );

  return (
    <div>
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
    </div>
  );
}
