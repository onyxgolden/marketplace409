import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import DashboardCardStack from "@/components/forge/financial/DashboardCardStack";
import {
  FINANCIAL_KPI_CARD_IDS,
  FINANCIAL_KPI_CARD_TITLES,
} from "@/components/forge/financial/dashboardCardLayout";

const surfaceVariants = Object.freeze({
  workspace:
    "grid grid-cols-2 gap-4 md:grid-cols-2 xl:grid-cols-4",
  embedded:
    "grid grid-cols-1 gap-3 sm:grid-cols-2",
});

// Pass cardLayoutStorageKey to make the KPI tiles a reorderable/hideable
// card system (persisted per user in localStorage). Omit it and the surface
// renders the static tile grid exactly as before.
export default function FinancialKpiSurface({
  variant = "workspace",
  kpis = [],
  cardLayoutStorageKey = null,
}) {
  const classes =
    surfaceVariants[variant] ??
    surfaceVariants.workspace;

  const tiles = kpis.map((kpi) => (
    <ForgeDashboardCard
      key={kpi.id}
      label={kpi.label}
      value={kpi.value}
      detail={kpi.detail}
      href={kpi.href ?? null}
    />
  ));

  if (!cardLayoutStorageKey) {
    return (
      <section
        data-financial-kpi-surface
        data-financial-kpi-variant={variant}
        className={classes}
      >
        {tiles}
      </section>
    );
  }

  const cards = kpis.map((kpi) => ({
    id: kpi.id,
    title: FINANCIAL_KPI_CARD_TITLES[kpi.id] ?? kpi.label,
    element: (
      <ForgeDashboardCard
        label={kpi.label}
        value={kpi.value}
        detail={kpi.detail}
        href={kpi.href ?? null}
      />
    ),
  }));

  // Any KPI outside the registry (future callers) is appended after the
  // registry order rather than silently dropped.
  const cardIds = [
    ...FINANCIAL_KPI_CARD_IDS.filter((id) => cards.some((card) => card.id === id)),
    ...cards
      .map((card) => card.id)
      .filter((id) => !FINANCIAL_KPI_CARD_IDS.includes(id)),
  ];

  return (
    <DashboardCardStack
      storageKey={cardLayoutStorageKey}
      cardIds={cardIds}
      cards={cards}
      className={classes}
      customizeLabel="Customize KPIs"
      data-financial-kpi-surface
      data-financial-kpi-variant={variant}
    />
  );
}
