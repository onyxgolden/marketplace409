import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgePortfolioSummary from "@/components/forge/ForgePortfolioSummary";
import ForgeSystemHealth from "@/components/forge/ForgeSystemHealth";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import ForgeInformationCenter from "@/components/forge/workspace/ForgeInformationCenter";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import TransactionReviewContainer from "@/components/forge/TransactionReviewContainer";

export default function ForgeWorkspaceDesktop({
  netWorth,
  riskSummary,
  riskAssessment,
  executiveBriefing,
  auditFindings,
  alertItems,
  insightItems,
  portfolioSummaryItems,
  systemHealthItems,
  systemStatusItems,
  recentActivities,
  formatCurrency,
  setView,
  ownerId,
  properties,
  transactionReview,
}) {
  const anomalyCount = auditFindings?.anomalies?.length ?? 0;

  return (
    <section>
      <header className="mb-6 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 px-6 py-5 text-white shadow-2xl lg:px-8 lg:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-400">
              FORGE Workbench
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-5xl">
              Your business operating surface
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 lg:text-base">
              Live financial position, transaction review, portfolio state,
              system intelligence, and pending actions in one coordinated
              environment.
            </p>
          </div>

          <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-5 py-3">
            <div className="text-xs font-black uppercase tracking-wide text-slate-300">
              Current risk
            </div>
            <div className="mt-1 text-2xl font-black text-amber-400">
              {riskSummary?.severity ?? "Unknown"}
            </div>
            <div className="text-sm text-slate-300">
              Score {riskSummary?.score ?? 0}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,0.8fr)]">
        <div className="grid gap-6 md:grid-cols-2">
          <ForgeWorkspaceTile
            eyebrow="Financial Application"
            title="Financial Position"
            detail="Executive financial intelligence, portfolio position, risk, and recommended actions."
            href="/forge/financial"
            actionLabel="Open financial workspace"
            status={riskSummary?.status ?? "Ready"}
            span="wide"
          >
            <ForgeKpiCards
              netWorth={netWorth}
              riskSummary={riskSummary}
              auditFindings={auditFindings}
              formatCurrency={formatCurrency}
              variant="embedded"
            />

            <div className="mt-5">
              <ForgeExecutiveBriefing
                executiveBriefing={executiveBriefing}
                riskAssessment={riskAssessment}
                variant="embedded"
              />
            </div>
          </ForgeWorkspaceTile>

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
                value={transactionReview?.metrics?.needsReviewCount ?? anomalyCount}
              />
              <QueueMetric
                label="Queue status"
                value={
                  transactionReview?.metrics?.needsReviewCount
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

          <ForgeWorkspaceTile
            eyebrow="Property Application"
            title="Property Portfolio"
            detail="Owner-scoped portfolio value and financial position represented by current holdings."
            href="/forge/financial"
            actionLabel="Open portfolio workspace"
            status="Owner scoped"
          >
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <ForgePortfolioSummary
                summaryItems={portfolioSummaryItems}
                variant="embedded"
              />
            </div>
          </ForgeWorkspaceTile>

          <ForgeWorkspaceTile
            eyebrow="Operating System"
            title="FORGE OS"
            detail="Runtime status and system health supporting the authenticated workbench."
            status="Active"
            span="wide"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <ForgeSystemStatus
                  statusItems={systemStatusItems}
                  variant="embedded"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <ForgeSystemHealth
                  healthItems={systemHealthItems}
                  variant="embedded"
                />
              </div>
            </div>
          </ForgeWorkspaceTile>
        </div>

        <ForgeInformationCenter
          alerts={alertItems}
          insights={insightItems}
          recentActivities={recentActivities}
          setView={setView}
        />
      </div>
    </section>
  );
}

function QueueMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function CompactQueueItem({ label, detail }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="font-bold text-slate-950">{label}</div>
      <div className="mt-1 text-sm leading-6 text-slate-600">{detail}</div>
    </div>
  );
}
