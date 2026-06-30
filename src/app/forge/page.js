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

  return (
    <ForgeDashboardShell
      view={view}
      setView={setView}
      netWorth={netWorth}
      riskSummary={riskSummary}
      riskAssessment={riskAssessment}
      executiveBriefing={executiveBriefing}
      auditFindings={auditFindings}
      formatCurrency={formatCurrency}
    />
  );
}
