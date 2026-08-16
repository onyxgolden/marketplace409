import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";

export default function ForgeNetWorthPanel({
  netWorth,
  formatCurrency,
}) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-slate-950 dark:text-white">
      <h2 className="text-2xl font-black">Net Worth Snapshot</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ForgeDashboardCard
          label="Total Assets"
          value={formatCurrency(netWorth.totalAssets)}
        />
        <ForgeDashboardCard
          label="Total Liabilities"
          value={formatCurrency(netWorth.totalLiabilities)}
        />
        <ForgeDashboardCard
          label="Net Worth"
          value={formatCurrency(netWorth.netWorth)}
        />
        <ForgeDashboardCard
          label="Debt Ratio"
          value={netWorth.debtToAssetRatio?.toFixed(2) ?? "0.00"}
        />
      </div>
    </section>
  );
}
