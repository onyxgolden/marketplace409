import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";

const surfaceVariants = Object.freeze({
  workspace:
    "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4",
  embedded:
    "grid grid-cols-1 gap-3 sm:grid-cols-2",
});

export default function FinancialKpiSurface({
  variant = "workspace",
  kpis = [],
}) {
  const classes =
    surfaceVariants[variant] ??
    surfaceVariants.workspace;

  return (
    <section
      data-financial-kpi-surface
      data-financial-kpi-variant={variant}
      className={classes}
    >
      {kpis.map((kpi) => (
        <ForgeDashboardCard
          key={kpi.id}
          label={kpi.label}
          value={kpi.value}
          detail={kpi.detail}
        />
      ))}
    </section>
  );
}
