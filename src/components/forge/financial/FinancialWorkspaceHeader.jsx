import FinancialKpiSurface from "@/components/forge/financial/FinancialKpiSurface";
import { forgeTheme } from "@/components/forge/theme";

const headerVariants = Object.freeze({
  workspace: {
    container: "space-y-6",
    hero: "rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:p-8 dark:border-slate-800 dark:bg-slate-900",
    title: "mt-3 text-4xl font-black tracking-tight text-slate-950 dark:text-slate-50",
  },
  embedded: {
    container: "space-y-4",
    hero: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900",
    title: "mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50",
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

            <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-400">
              {description}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-950/30">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Health Status
            </div>

            <div className="mt-1 text-2xl font-black text-amber-950 dark:text-amber-200">
              {health.label}
            </div>

            <div className="mt-1 max-w-xs text-sm text-amber-800 dark:text-amber-300">
              {health.detail}
            </div>
          </div>
        </div>
      </section>

      <FinancialKpiSurface
        kpis={kpis}
        variant={
          variant === "embedded"
            ? "embedded"
            : "workspace"
        }
      />
    </section>
  );
}
