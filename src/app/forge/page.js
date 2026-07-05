"use client";

import React, { useEffect, useMemo, useState } from "react";
import ForgeDashboardShell from "@/components/forge/ForgeDashboardShell";

export const dynamic = "force-dynamic";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

const ledgerContext = {
  accounts: [
    { id: "1000", name: "Cash", balance: 280000 },
    { id: "1100", name: "Accounts Receivable", balance: 120000 },
    { id: "2000", name: "Debt", balance: -40000 },
  ],
  postings: [],
};

const assets = [{ id: "cash", name: "Cash", category: "bank", value: 280000 }];

const liabilities = [
  { id: "debt", name: "Debt", category: "loan", balance: 0 },
];

const fallbackDashboardIntelligence = {
  auditFindings: {
    anomalies: [],
  },
  riskDashboard: {
    summary: {
      severity: "low",
      score: 0,
      findingCount: 0,
      severityCounts: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      topRisks: [],
      status: "Loading",
      summary: "Dashboard intelligence is loading.",
    },
    assessment: {
      summary: "Dashboard intelligence is loading.",
      primaryDrivers: [],
      recommendations: ["Continue routine monitoring."],
      trendIndicators: [],
    },
    executiveBriefing: {
      headline: "Dashboard intelligence loading.",
      overview: "Dashboard intelligence is loading.",
      improvements: [],
      concerns: [],
      priorities: [],
      recommendedActions: ["Continue routine monitoring."],
      outlook: "Dashboard intelligence is being prepared.",
    },
  },
  netWorth: {
    totalAssets: 0,
    totalLiabilities: 0,
    netWorth: 0,
    debtToAssetRatio: 0,
  },
};

export default function ForgePage() {
  const [view, setView] = useState("networth");
  const [dashboardIntelligence, setDashboardIntelligence] = useState(
    fallbackDashboardIntelligence,
  );

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardIntelligence() {
      try {
        const response = await fetch("/api/financial/dashboard-intelligence", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ledgerContext,
            assets,
            liabilities,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Unable to load dashboard intelligence.",
          );
        }

        if (isMounted) {
          setDashboardIntelligence(payload.data);
        }
      } catch (error) {
        if (isMounted) {
          setDashboardIntelligence({
            ...fallbackDashboardIntelligence,
            auditFindings: {
              anomalies: [],
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to load dashboard intelligence.",
            },
          });
        }
      }
    }

    loadDashboardIntelligence();

    return () => {
      isMounted = false;
    };
  }, []);

  const auditFindings =
    dashboardIntelligence.auditFindings ??
    fallbackDashboardIntelligence.auditFindings;

  const riskDashboard =
    dashboardIntelligence.riskDashboard ??
    fallbackDashboardIntelligence.riskDashboard;

  const netWorth =
    dashboardIntelligence.netWorth ?? fallbackDashboardIntelligence.netWorth;

  const riskSummary = riskDashboard.summary;
  const riskAssessment = riskDashboard.assessment;
  const executiveBriefing = riskDashboard.executiveBriefing;

  const alertItems = useMemo(() => {
    return [
      {
        label: riskSummary.status,
        detail: riskSummary.summary,
      },
      {
        label: "Audit Findings",
        detail: `${auditFindings?.anomalies?.length ?? 0} active findings in the current read-only scan.`,
      },
    ];
  }, [auditFindings, riskSummary]);

  const insightItems = useMemo(() => {
    return [
      {
        label: "Executive Outlook",
        detail: executiveBriefing.outlook,
      },
      {
        label: "Recommended Focus",
        detail:
          riskAssessment.recommendations[0] ?? "Continue routine monitoring.",
      },
    ];
  }, [executiveBriefing, riskAssessment]);

  const portfolioSummaryItems = useMemo(() => {
    return [
      { label: "Assets", value: formatCurrency(netWorth.totalAssets) },
      {
        label: "Liabilities",
        value: formatCurrency(netWorth.totalLiabilities),
      },
      { label: "Net Worth", value: formatCurrency(netWorth.netWorth) },
    ];
  }, [netWorth]);

  const systemHealthItems = useMemo(() => {
    return [
      {
        label: "Dashboard Shell",
        status: "online",
        detail: "Executive dashboard composition is active.",
      },
      {
        label: "Dashboard Intelligence API",
        status: auditFindings?.error ? "review" : "online",
        detail:
          auditFindings?.error ??
          "Dashboard intelligence loaded through the financial application API.",
      },
      {
        label: "Risk Services",
        status: "online",
        detail:
          "Risk dashboard service returned current summary and assessment.",
      },
    ];
  }, [auditFindings]);

  const systemStatusItems = useMemo(() => {
    return [
      {
        label: "Risk Engine",
        detail: riskSummary.summary,
        value: riskSummary.status,
      },
      {
        label: "Audit Layer",
        detail: "Read-only anomaly scan completed.",
        value: `${auditFindings?.anomalies?.length ?? 0} findings`,
      },
      {
        label: "Net Worth",
        detail: "Snapshot calculation completed.",
        value: formatCurrency(netWorth.netWorth),
      },
    ];
  }, [auditFindings, netWorth, riskSummary]);

  const recentActivities = useMemo(() => {
    return [
      {
        id: "dashboard-intelligence",
        label: "Dashboard intelligence refreshed",
        detail:
          "Financial dashboard intelligence loaded through the application API.",
        type: "system",
        timestamp: "Current session",
      },
      {
        id: "audit-findings",
        label: "Audit scan completed",
        detail: `${auditFindings?.anomalies?.length ?? 0} anomalies detected.`,
        type: "audit",
        timestamp: "Current session",
      },
      {
        id: "net-worth",
        label: "Net worth snapshot calculated",
        detail: `Current net worth is ${formatCurrency(netWorth.netWorth)}.`,
        type: "wealth",
        timestamp: "Current session",
      },
    ];
  }, [auditFindings, netWorth]);

  return (
    <ForgeDashboardShell
      view={view}
      setView={setView}
      netWorth={netWorth}
      riskSummary={riskSummary}
      riskAssessment={riskAssessment}
      executiveBriefing={executiveBriefing}
      auditFindings={auditFindings}
      alertItems={alertItems}
      insightItems={insightItems}
      portfolioSummaryItems={portfolioSummaryItems}
      systemHealthItems={systemHealthItems}
      systemStatusItems={systemStatusItems}
      recentActivities={recentActivities}
      formatCurrency={formatCurrency}
    />
  );
}
