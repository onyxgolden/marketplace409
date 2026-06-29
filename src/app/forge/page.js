"use client";

import React, { useMemo, useState } from "react";
import Header from "@/components/Header";
import { NetWorthService } from "@/domains/networth";

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

  /**
   * STEP 15 — Mock Ledger Context (READ-ONLY INPUT)
   * Replace later with real ledger injection if available in domain context.
   */
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

  /**
   * STEP 15 — Autonomous Audit Execution (READ ONLY)
   */
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

  /**
   * NET WORTH (existing system)
   */
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
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-6xl mx-auto p-6">
        {/* NAV TABS */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setView("networth")}
            className={`px-4 py-2 rounded ${
              view === "networth" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Net Worth
          </button>

          <button
            onClick={() => setView("audit")}
            className={`px-4 py-2 rounded ${
              view === "audit" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Live Audit
          </button>
        </div>

        {/* NET WORTH VIEW */}
        {view === "networth" && (
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-xl font-bold mb-4">Net Worth Snapshot</h2>

            <div className="space-y-2">
              <div>Total Assets: {formatCurrency(netWorth.totalAssets)}</div>
              <div>
                Total Liabilities: {formatCurrency(netWorth.totalLiabilities)}
              </div>
              <div className="font-bold">
                Net Worth: {formatCurrency(netWorth.netWorth)}
              </div>
              <div>
                Debt Ratio: {netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"}
              </div>
            </div>
          </div>
        )}

        {/* AUDIT DASHBOARD VIEW — STEP 15 */}
        {view === "audit" && (
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-xl font-bold mb-4">
              Live Audit Dashboard (Autonomous Audit Agent)
            </h2>

            {auditFindings?.error && (
              <div className="text-red-600 mb-4">
                Error: {auditFindings.error}
              </div>
            )}

            {!auditFindings?.anomalies?.length && (
              <div className="text-gray-500">
                No anomalies detected in current ledger snapshot.
              </div>
            )}

            <div className="space-y-4">
              {auditFindings?.anomalies?.map((a, idx) => (
                <div
                  key={idx}
                  className="border rounded p-4 bg-gray-50"
                >
                  <div className="font-semibold">
                    Account: {a.accountId ?? "unknown"}
                  </div>

                  <div className="mt-1 text-sm text-gray-700">
                    Anomaly: {a.type}
                  </div>

                  <div className="mt-1 text-sm">
                    Explanation: {a.explanation}
                  </div>

                  {a.traceSummary && (
                    <div className="mt-2 text-xs text-gray-500">
                      Trace: {a.traceSummary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
