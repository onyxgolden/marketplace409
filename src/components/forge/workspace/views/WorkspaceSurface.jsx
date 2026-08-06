const surfaceVariants = Object.freeze({
  workspace: "space-y-6",
  embedded: "space-y-5",
});

export default function WorkspaceSurface({
  surfaceIdentity,
  variant = "workspace",
  header,
  executive,
  primary,
  secondary,
  sidebar,
  footer,
}) {
  const resolvedSurfaceIdentity =
    typeof surfaceIdentity === "string" &&
    surfaceIdentity.trim().length
      ? surfaceIdentity.trim()
      : "workspace";

  return (
    <section
      data-workspace-surface={resolvedSurfaceIdentity}
      data-workspace-variant={variant}
      className={
        surfaceVariants[variant] ??
        surfaceVariants.workspace
      }
    >
      {header && (
        <section data-workspace-region="header">
          {header}
        </section>
      )}

      {executive && (
        <section data-workspace-region="executive">
          {executive}
        </section>
      )}

      {primary && !sidebar && (
        <section data-workspace-region="primary">
          {primary}
        </section>
      )}

      {sidebar && (
        <section
          data-workspace-region="operations"
          className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]"
        >
          <div data-workspace-region="primary">
            {primary}
          </div>

          <aside
            data-workspace-region="sidebar"
            className="space-y-6"
          >
            {sidebar}
          </aside>
        </section>
      )}

      {secondary && (
        <section data-workspace-region="secondary">
          {secondary}
        </section>
      )}

      {footer && (
        <footer data-workspace-region="footer">
          {footer}
        </footer>
      )}
    </section>
  );
}
