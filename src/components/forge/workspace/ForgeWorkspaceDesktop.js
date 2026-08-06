import { Fragment } from "react";

import ForgeInformationCenter from "@/components/forge/workspace/ForgeInformationCenter";
import { createWorkspaceRegistry } from "@/components/forge/workspace/composition/createWorkspaceRegistry";

const workspaceRegistry =
  createWorkspaceRegistry();

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
  const workspaceContext = {
    netWorth,
    riskSummary,
    riskAssessment,
    executiveBriefing,
    auditFindings,
    portfolioSummaryItems,
    systemHealthItems,
    systemStatusItems,
    formatCurrency,
    ownerId,
    properties,
    transactionReview,
  };

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
          {workspaceRegistry
            .list()
            .map((workspaceModule) => (
              <Fragment
                key={
                  workspaceModule.moduleIdentity
                }
              >
                {workspaceModule.renderTile(
                  workspaceContext,
                )}
              </Fragment>
            ))}
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
