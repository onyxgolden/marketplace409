"use client";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ArrowRight, CheckCircle2, Circle, RefreshCw } from "lucide-react";

// Dismissal persists in localStorage (deliberately not a migration): it is a
// per-browser UI preference, not workspace data, and the wizard re-appears on a
// fresh device until that browser is dismissed too — acceptable for a one-time
// tour, and the Setup guide entry under Settings always offers a re-run.
export const SETUP_WIZARD_DISMISSAL_STORAGE_KEY = "forge-rental-setup-wizard-dismissed:v1";

export function readSetupWizardDismissal() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupWizardDismissal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable — the wizard simply shows again next load.
  }
}

export async function fetchSetupWizardStatus() {
  const response = await fetch("/api/rental/setup-wizard-status");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load setup progress.");
  return body;
}

const STEP_STATUS_STYLES = {
  done: { badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300", label: "Done" },
  optional: { badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", label: "Optional" },
  todo: { badge: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300", label: "To do" },
};

function stepStatus(step) {
  if (step.complete) return "done";
  if (step.optional) return "optional";
  return "todo";
}

function WizardActionButton({ action, onNavigate }) {
  const className = "inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300";
  if (action.kind === "href") {
    return (
      <a href={action.href} className={className}>
        {action.label}
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    );
  }
  return (
    <button type="button" onClick={() => onNavigate?.(action.functionId)} className={className}>
      {action.label}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  );
}

function WizardStepTile({ index, step, onNavigate }) {
  const status = stepStatus(step);
  const styles = STEP_STATUS_STYLES[status];
  const StatusIcon = status === "done" ? CheckCircle2 : Circle;
  return (
    <article
      data-setup-wizard-step={step.id}
      data-setup-wizard-step-status={status}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${
              status === "done"
                ? "bg-emerald-600 text-white"
                : "bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950"
            }`}
          >
            {index + 1}
          </span>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">{step.title}</h3>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ${styles.badge}`}>
          <StatusIcon size={14} aria-hidden="true" />
          {styles.label}
        </span>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.whyOrder}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {step.actions.map((action) => (
          <WizardActionButton key={action.label} action={action} onNavigate={onNavigate} />
        ))}
      </div>
    </article>
  );
}

// Guided setup wizard (Rentec-parity slice R16): the ordered first-run tour —
// Settings -> Banking -> Owners -> Managers -> Properties -> Tenants — with the
// plain-English reason each step comes where it does. mode="first-run" is the
// auto-shown tour on an unsetup workspace's landing; mode="guide" is the
// re-runnable Setup guide under Settings.
export default function RentalSetupWizardPanel({ mode = "guide", onNavigate, onExit }) {
  // ttlMs 0: every mount revalidates, so a step completed on another surface
  // shows as done the moment the user comes back to the wizard.
  const { data: status, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:setup-wizard-status",
    fetchSetupWizardStatus,
    { ttlMs: 0 },
  );
  const firstRun = mode === "first-run";

  if (isLoading && !status) return <ForgeLoadingState label="Loading your setup guide…" />;
  if (!status && loadError) {
    return (
      <ForgeErrorState
        title="Unable to load setup progress"
        detail={loadError.message || String(loadError)}
        onRetry={() => refresh()}
      />
    );
  }

  const steps = status?.steps || [];
  const requiredDone = status?.completeCount ?? 0;
  const requiredTotal = status?.totalCount ?? 0;
  const progressPercent = requiredTotal > 0 ? Math.round((requiredDone / requiredTotal) * 100) : 0;

  function handleSkip() {
    writeSetupWizardDismissal();
    onExit?.();
  }

  return (
    <section data-setup-wizard-panel data-setup-wizard-mode={mode} aria-label={firstRun ? "Rental Manager setup tour" : "Rental Manager setup guide"} className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">
              {firstRun ? "Welcome to the Rental Manager" : "Setup guide"}
            </p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">
              {firstRun ? "Let's get you set up" : "Finish setting up"}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {firstRun
                ? "This takes about 10 minutes and you only do it once. The steps are in order on purpose — each one explains why it comes where it does."
                : "Your setup progress, in order. Steps marked done are read from your actual records, so they stay honest."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={isRefreshing}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "animate-spin" : ""} />
            {isRefreshing ? "Checking…" : "Check again"}
          </button>
        </div>
        {requiredTotal > 0 && (
          <div className="mt-5" role="status" aria-label={`${requiredDone} of ${requiredTotal} required steps done`}>
            <div className="flex items-center justify-between text-xs font-black text-slate-500 dark:text-slate-400">
              <span>{requiredDone} of {requiredTotal} required steps done</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all dark:bg-emerald-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
        {status && loadError ? (
          <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">
            Could not refresh — showing the last saved progress.
          </p>
        ) : null}
      </header>

      <ol className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.id}>
            <WizardStepTile index={index} step={step} onNavigate={onNavigate} />
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap items-center gap-3">
        {firstRun ? (
          <>
            <button
              type="button"
              data-setup-wizard-skip
              onClick={handleSkip}
              className="text-sm font-black text-slate-500 underline decoration-2 underline-offset-2 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Skip the tour — I&apos;ll set up later
            </button>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can re-run this guide any time from Settings → Setup guide.
            </p>
          </>
        ) : (
          <button
            type="button"
            data-setup-wizard-exit
            onClick={() => onExit?.()}
            className={`rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}
          >
            Back to Summary
          </button>
        )}
      </footer>
    </section>
  );
}
