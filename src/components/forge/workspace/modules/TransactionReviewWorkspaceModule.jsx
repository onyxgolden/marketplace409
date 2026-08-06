import TransactionReviewContainer from "@/components/forge/TransactionReviewContainer";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function QueueMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950">
        {value}
      </div>
    </div>
  );
}

function renderTransactionReviewWorkspaceTile({
  auditFindings,
  transactionReview,
  properties,
  ownerId,
}) {
  const anomalyCount =
    auditFindings?.anomalies?.length ?? 0;

  const needsReviewCount =
    transactionReview?.metrics?.needsReviewCount ??
    anomalyCount;

  return (
    <ForgeWorkspaceTile
      eyebrow="Review Application"
      title="Transaction Review"
      detail="Resolve unknown transactions and strengthen future property-assignment rules."
      href="/import"
      actionLabel="Open transaction review"
      status={anomalyCount ? "Review" : "Clear"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <QueueMetric
          label="Items requiring review"
          value={needsReviewCount}
        />

        <QueueMetric
          label="Queue status"
          value={
            needsReviewCount
              ? "Action required"
              : "Current"
          }
        />
      </div>

      <div className="mt-5">
        <TransactionReviewContainer
          reviews={transactionReview?.items || []}
          properties={properties}
          ownerId={ownerId}
        />
      </div>
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
