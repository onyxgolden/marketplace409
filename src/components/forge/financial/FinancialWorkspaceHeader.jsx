import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import { forgeTheme } from "@/components/forge/theme";

const headerVariants = Object.freeze({
  workspace: {
    container: "space-y-6",
    hero: "rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:p-8",
    title: "mt-3 text-4xl font-black tracking-tight text-slate-950",
  },
  embedded: {
    container: "space-y-4",
    hero: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
    title: "mt-2 text-2xl font-black tracking-tight text-slate-950",
  },
});

export default function FinancialWorkspaceHeader({
  variant = "workspace",
  eyebrow = "FORGE Financial Command",
  title = "Executive KPI Dashboard",
  description = "Financial performance, cash position, equity, and operating margin surfaced from the FORGE financial engine and dashboard domain service.",
  health = {
    label: "Loading",
    detail: "Financial health is being prepared.",
  },
  kpis = [],
}) {
  const styles =
    headerVariants[variant] ??
    headerVariants.workspace;

  return (
    <section
      data-financial-workspace-header
      data-financial-header-variant={variant}
      className={styles.container}
    >
      <section className={styles.hero}>
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className={forgeTheme.labelSmall}>
              {eyebrow}
            </div>

            <h1 className={styles.title}>
              {title}
            </h1>

            <p className="mt-3 max-w-3xl text-slate-600">
              {description}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">
              Health Status
            </div>

            <div className="mt-1 text-2xl font-black text-amber-950">
              {health.label}
            </div>

            <div className="mt-1 max-w-xs text-sm text-amber-800">
              {health.detail}
            </div>
          </div>
        </div>
      </section>

      <section
        data-financial-kpi-surface
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
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
    </section>
  );
}
