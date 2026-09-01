import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function QueueMetric({
  label,
  value,
  tone = "neutral",
}) {
  const valueClassName =
    tone === "attention"
      ? "text-amber-700 dark:text-amber-400"
      : "text-slate-950 dark:text-slate-50";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>

      <div
        className={`mt-2 text-2xl font-black ${valueClassName}`}
      >
        {value}
      </div>
    </div>
  );
}

function renderTransactionReviewWorkspaceTile({
  auditFindings,
  transactionReview,
}) {
  const anomalyCount =
    auditFindings?.anomalies?.length ?? 0;

  const needsReviewCount =
    transactionReview?.metrics?.needsReviewCount ??
    anomalyCount;

  const requiresAttention =
    needsReviewCount > 0;

  return (
    <ForgeWorkspaceTile
      eyebrow="Review Application"
      title="Transaction Review"
      detail="Resolve unknown transactions and strengthen future property-assignment rules."
      href="/forge/import"
      actionLabel="Open transaction review"
      status={
        requiresAttention
          ? "Review"
          : "Clear"
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <QueueMetric
          label="Items requiring review"
          value={needsReviewCount}
          tone={
            requiresAttention
              ? "attention"
              : "neutral"
          }
        />

        <QueueMetric
          label="Queue status"
          value={
            requiresAttention
              ? "Action required"
              : "Current"
          }
          tone={
            requiresAttention
              ? "attention"
              : "neutral"
          }
        />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Open the application to inspect transactions,
        assign properties, and manage review decisions.
      </p>
    </ForgeWorkspaceTile>
  );
}

export const TransactionReviewWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "transaction-review",
    displayName: "Transaction Review",
    category: "review",
    priority: 20,
    renderTile:
      renderTransactionReviewWorkspaceTile,
  });
