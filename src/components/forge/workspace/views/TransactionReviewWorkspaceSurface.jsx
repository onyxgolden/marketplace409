import WorkspaceSurface from "./WorkspaceSurface.jsx";

export default function TransactionReviewWorkspaceSurface({
  variant = "workspace",
  header,
  summary,
  queue,
  sidebar,
  footer,
}) {
  return (
    <WorkspaceSurface
      surfaceIdentity="transaction-review"
      variant={variant}
      header={header}
      executive={summary}
      primary={queue}
      sidebar={sidebar}
      footer={footer}
    />
  );
}
