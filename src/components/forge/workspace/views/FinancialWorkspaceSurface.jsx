import WorkspaceSurface from "./WorkspaceSurface.jsx";

export default function FinancialWorkspaceSurface({
  variant = "workspace",
  header,
  executive,
  portfolio,
  sidebar,
}) {
  return (
    <WorkspaceSurface
      surfaceIdentity="financial"
      variant={variant}
      header={header}
      executive={executive}
      primary={portfolio}
      sidebar={sidebar}
    />
  );
}
