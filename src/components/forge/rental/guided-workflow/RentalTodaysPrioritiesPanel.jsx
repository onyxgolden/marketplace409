"use client";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CircleAlert, Info, PartyPopper, PauseCircle, PlayCircle } from "lucide-react";
import { GUIDED_WORKFLOW_SESSION_STATUS } from "@/domains/guided-workflow";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useTodaysPrioritiesSession } from "./useTodaysPrioritiesSession";

// Same severity treatment as ForgeNeedsAttentionQueue -- this panel walks the identical data one item at
// a time rather than as a flat list, so the visual vocabulary should read as the same feature, not a
// competing one.
const SEVERITY_STYLES = {
  critical: { icon: AlertTriangle, dot: "bg-red-600", label: "text-red-700 dark:text-red-400" },
  warning: { icon: CircleAlert, dot: "bg-amber-500", label: "text-amber-700 dark:text-amber-400" },
  info: { icon: Info, dot: "bg-sky-500", label: "text-sky-700 dark:text-sky-400" },
};

function GuidedControlButton({ control, onClick, disabled, children }) {
  return (
    <button
      type="button"
      data-guided-workflow-control={control}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

export default function RentalTodaysPrioritiesPanel({ onNavigate }) {
  const {
    summary, session, currentStep, currentAttentionItem, loading, error,
    canGoBack, next, back, pause, resume, exit, restart,
  } = useTodaysPrioritiesSession();
  const [showWhy, setShowWhy] = useState(false);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
        <p className="font-bold">{error}</p>
        <button type="button" onClick={restart} className="mt-3 text-sm font-black underline">Try again</button>
      </div>
    );
  }

  if (loading && !session) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Loading today&apos;s priorities…</p>;
  }

  if (!session) return null;

  return (
    <section data-guided-workflow-panel aria-label="Today's priorities, guided" className="space-y-4">
      <header>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Today&apos;s priorities</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">One item at a time, ordered by urgency.</p>
      </header>

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.EXITED && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Guidance exited.</p>
          <button type="button" data-guided-workflow-control="restart" onClick={restart} className={`mt-3 rounded-lg px-4 py-2 text-sm font-black ${goldControlClassName}`}>
            Start again
          </button>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.PAUSED && (
        <div data-guided-workflow-paused className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Guidance paused.</p>
          <GuidedControlButton control="resume" onClick={resume}>
            <span className="flex items-center gap-2"><PlayCircle size={16} aria-hidden="true" />Resume</span>
          </GuidedControlButton>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <PartyPopper size={20} aria-hidden="true" />
          <p className="text-sm font-bold">Nothing urgent right now.</p>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE && currentStep && currentAttentionItem && (
        <div
          data-guided-workflow-step={currentStep.stepId}
          aria-live="polite"
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {summary && summary.needsAttention.length > 0 && (
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">
              Priority {summary.needsAttention.findIndex((item) => item.id === currentAttentionItem.id) + 1} of {summary.needsAttention.length}
            </p>
          )}

          <div className="mt-3 flex items-start gap-3">
            {(() => {
              const style = SEVERITY_STYLES[currentAttentionItem.severity] || SEVERITY_STYLES.info;
              const Icon = style.icon;
              return (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.dot} text-white`} aria-hidden="true">
                  <Icon size={18} strokeWidth={2.5} />
                </span>
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-base font-black text-slate-950 dark:text-white">{currentStep.instruction}</p>
              {currentAttentionItem.detail && (
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{currentAttentionItem.detail}</p>
              )}
            </div>
          </div>

          {currentStep.explanation && (
            <div className="mt-3">
              <button
                type="button"
                data-guided-workflow-control="why"
                onClick={() => setShowWhy((prev) => !prev)}
                aria-expanded={showWhy}
                className="text-xs font-black uppercase tracking-wide text-sky-700 underline dark:text-sky-400"
              >
                Why does this matter?
              </button>
              {showWhy && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{currentStep.explanation}</p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.(currentAttentionItem.destination)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black ${goldControlClassName}`}
            >
              Open <ArrowRight size={14} aria-hidden="true" />
            </button>
            <GuidedControlButton control="back" onClick={back} disabled={!canGoBack || loading}>Back</GuidedControlButton>
            <GuidedControlButton control="pause" onClick={pause} disabled={loading}>
              <span className="flex items-center gap-2"><PauseCircle size={16} aria-hidden="true" />Pause</span>
            </GuidedControlButton>
            <GuidedControlButton control="exit" onClick={exit} disabled={loading}>Exit guidance</GuidedControlButton>
            <button
              type="button"
              data-guided-workflow-control="next"
              onClick={next}
              disabled={loading}
              className="ml-auto text-sm font-black text-slate-700 underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300"
            >
              {loading ? "Checking…" : "Next"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
