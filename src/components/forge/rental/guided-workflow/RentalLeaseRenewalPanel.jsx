"use client";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CircleAlert, FileText, PartyPopper, PauseCircle, PlayCircle } from "lucide-react";
import { GUIDED_WORKFLOW_SESSION_STATUS, LEASE_RENEWAL_COPY, LEASE_RENEWAL_DESTINATION_BY_STEP_ID } from "@/domains/guided-workflow";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { resolveLeaseIdentity } from "../RentalLeaseLifecyclePanel";
import { useLeaseRenewalSession } from "./useLeaseRenewalSession";

const STATUS_STYLES = {
  required: { icon: CircleAlert, dot: "bg-amber-500" },
  blocked: { icon: AlertTriangle, dot: "bg-red-600" },
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

function LeasePicker({ expiringLeases, rentalData, loading, error, onSelect, onRetry }) {
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
        <p className="font-bold">{error}</p>
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-black underline">Try again</button>
      </div>
    );
  }
  if (loading) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Loading leases expiring soon…</p>;
  }
  if (expiringLeases.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <FileText size={20} className="text-slate-400" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-600 dark:text-slate-400">No leases are expiring within 30 days right now.</p>
      </div>
    );
  }
  return (
    <div data-guided-workflow-lease-picker className="space-y-2">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Which lease are you renewing?</p>
      <ul className="space-y-2">
        {expiringLeases.map((lease) => {
          const identity = resolveLeaseIdentity(lease, rentalData);
          return (
            <li key={lease.id}>
              <button
                type="button"
                data-guided-workflow-control="select-lease"
                data-lease-id={lease.id}
                onClick={() => onSelect(lease.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
              >
                <span className="font-bold text-slate-900 dark:text-white">
                  {identity.tenantLabel} · {identity.unitLabel} · ends {lease.end_date}
                </span>
                <ArrowRight size={16} className="text-slate-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function RentalLeaseRenewalPanel({ onNavigate }) {
  const {
    expiringLeases, leaseId, selectedLease, rentalData, session, currentStep, currentStepResult, loading, error,
    canGoBack, hasUnavailableSteps, selectLease, changeLease, next, back, pause, resume, exit, restart,
  } = useLeaseRenewalSession();
  const [showWhy, setShowWhy] = useState(false);

  if (!leaseId || !session) {
    return (
      <section data-guided-workflow-panel aria-label="Renew an expiring lease" className="space-y-4">
        <header>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Renew an expiring lease</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a lease expiring within 30 days and FORGE will walk through renewing it.</p>
        </header>
        <LeasePicker expiringLeases={expiringLeases} rentalData={rentalData} loading={loading} error={error} onSelect={selectLease} onRetry={restart} />
      </section>
    );
  }

  const isFinalReview = currentStep && currentStep.stepId === "renewal-review";
  const copy = currentStep && currentStepResult ? LEASE_RENEWAL_COPY[currentStep.stepId]?.[currentStepResult.reasonCode] : null;
  const destination = currentStep ? LEASE_RENEWAL_DESTINATION_BY_STEP_ID[currentStep.stepId] : null;
  const leaseIdentity = selectedLease && rentalData ? resolveLeaseIdentity(selectedLease, rentalData) : null;

  return (
    <section data-guided-workflow-panel aria-label="Renew an expiring lease, guided" className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Renew {leaseIdentity?.unitLabel || "this lease"}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">One step at a time, in order.</p>
        </div>
        <button type="button" data-guided-workflow-control="change-lease" onClick={changeLease} className="text-xs font-black uppercase tracking-wide text-slate-500 underline dark:text-slate-400">
          Change lease
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
          <p className="font-bold">{error}</p>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.EXITED && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Guidance exited.</p>
          <button type="button" data-guided-workflow-control="restart" onClick={() => selectLease(leaseId)} className={`mt-3 rounded-lg px-4 py-2 text-sm font-black ${goldControlClassName}`}>
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
          <p className="text-sm font-bold">{hasUnavailableSteps ? "Review complete, but some categories couldn't be checked." : "This lease has been renewed."}</p>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE && currentStep && isFinalReview && (
        <div
          data-guided-workflow-step={currentStep.stepId}
          aria-live="polite"
          className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <PartyPopper size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-black">This lease has been renewed.</p>
            <p className="mt-1 text-sm font-semibold">This lease&apos;s renewal has been approved and applied.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <GuidedControlButton control="back" onClick={back} disabled={!canGoBack || loading}>Back</GuidedControlButton>
              <button
                type="button"
                data-guided-workflow-control="next"
                onClick={next}
                disabled={loading}
                className={`rounded-lg px-4 py-2 text-sm font-black ${goldControlClassName}`}
              >
                {loading ? "Checking…" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {session.status === GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE && currentStep && !isFinalReview && (
        <div
          data-guided-workflow-step={currentStep.stepId}
          aria-live="polite"
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start gap-3">
            {(() => {
              const style = STATUS_STYLES[currentStepResult?.status] || STATUS_STYLES.required;
              const Icon = style.icon;
              return (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.dot} text-white`} aria-hidden="true">
                  <Icon size={18} strokeWidth={2.5} />
                </span>
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-base font-black text-slate-950 dark:text-white">{copy?.label || currentStep.instruction}</p>
              {copy?.detail && <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{copy.detail}</p>}
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
            {destination && (
              <button
                type="button"
                onClick={() => onNavigate?.(destination)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black ${goldControlClassName}`}
              >
                Open <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
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
