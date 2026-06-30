import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";

export default function ForgeKpiCards({
  netWorth,
  riskSummary,
  auditFindings,
  formatCurrency,
}) {
  return (
    <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ForgeDashboardCard
        label="Net Worth"
        value={formatCurrency(netWorth.netWorth)}
        detail={`Assets ${formatCurrency(netWorth.totalAssets)}`}
      />
      <ForgeDashboardCard
        label="Debt Ratio"
        value={netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"}
        detail={`Liabilities ${formatCurrency(netWorth.totalLiabilities)}`}
      />
      <ForgeDashboardCard
        label="Risk Score"
        value={riskSummary.score}
        detail={`${riskSummary.severityCounts.high} high · ${riskSummary.severityCounts.critical} critical`}
      />
      <ForgeDashboardCard
        label="Audit Status"
        value={auditFindings?.anomalies?.length ? "Review" : "Clear"}
        detail={
          auditFindings?.anomalies?.length
            ? `${auditFindings.anomalies.length} anomalies`
            : "No anomalies detected"
        }
      />
    </section>
  );
}
