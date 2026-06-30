"use client";

import React, { useMemo, useState } from "react";
import ForgeDashboardShell from "@/components/forge/ForgeDashboardShell";
import { NetWorthService } from "@/domains/networth";
import { RiskDashboardService } from "@/domains/risk";

// STEP 15 — READ-ONLY AUDIT LAYER
import { autonomousAuditAgent } from "@/domains/audit/AutonomousAuditAgent";
import { TraceIntelligenceService } from "@/domains/ledger/trace/TraceIntelligenceService";
import { TraceResolver } from "@/domains/ledger/trace/TraceResolver";

export const dynamic = "force-dynamic";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

export default function ForgePage() {
  const [view, setView] = useState("networth");

  const ledgerContext = useMemo(() => {
    return {
      accounts: [
        { id: "1000", name: "Cash", balance: 280000 },
        { id: "1100", name: "Accounts Receivable", balance: 120000 },
        { id: "2000", name: "Debt", balance: -40000 },
      ],
      postings: [],
    };
  }, []);

  const auditFindings = useMemo(() => {
    try {
      return autonomousAuditAgent.run({
        ledger: ledgerContext,
        traceResolver: TraceResolver,
        traceIntelligence: TraceIntelligenceService,
      });
    } catch (e) {
      return {
        anomalies: [],
        error: e.message,
      };
    }
  }, [ledgerContext]);

  const riskDashboard = useMemo(() => {
    const dashboardService = new RiskDashboardService();

    return dashboardService.build({
      auditFindings: auditFindings?.anomalies ?? [],
    });
  }, [auditFindings]);

  const riskSummary = riskDashboard.summary;
  const riskAssessment = riskDashboard.assessment;
  const executiveBriefing = riskDashboard.executiveBriefing;

  const netWorth = useMemo(() => {
    const assets = [
      { id: "cash", name: "Cash", category: "bank", value: 280000 },
    ];

    const liabilities = [
      { id: "debt", name: "Debt", category: "loan", balance: 0 },
    ];

    return NetWorthService.calculate(assets, liabilities);
  }, []);

  const recentActivities = useMemo(() => {
    return [
      {
        id: "risk-dashboard",
        label: "Risk dashboard refreshed",
        detail: riskSummary.summary,
        type: "risk",
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
  }, [auditFindings, netWorth, riskSummary]);

  return (
    <ForgeDashboardShell
      view={view}
      setView={setView}
      netWorth={netWorth}
      riskSummary={riskSummary}
      riskAssessment={riskAssessment}
      executiveBriefing={executiveBriefing}
      auditFindings={auditFindings}
      recentActivities={recentActivities}
      formatCurrency={formatCurrency}
    />
  );
}
