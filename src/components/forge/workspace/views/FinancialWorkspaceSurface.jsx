const surfaceVariants = Object.freeze({
  workspace: "space-y-6",
  embedded: "space-y-5",
});

export default function FinancialWorkspaceSurface({
  variant = "workspace",
  header,
  executive,
  portfolio,
  sidebar,
}) {
  return (
    <section
      data-workspace-surface="financial"
      data-workspace-variant={variant}
      className={surfaceVariants[variant] ?? surfaceVariants.workspace}
    >
      {header && (
        <section data-financial-workspace-region="header">
          {header}
        </section>
      )}

      {executive && (
        <section data-financial-workspace-region="executive">
          {executive}
        </section>
      )}

      {portfolio && !sidebar && (
        <section data-financial-workspace-region="portfolio">
          {portfolio}
        </section>
      )}

      {sidebar && (
        <section
          data-financial-workspace-region="operations"
          className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]"
        >
          <div data-financial-workspace-region="portfolio">
            {portfolio}
          </div>

          <aside
            data-financial-workspace-region="sidebar"
            className="space-y-6"
          >
            {sidebar}
          </aside>
        </section>
      )}
    </section>
  );
}
