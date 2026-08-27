"use client";
import { useEffect } from "react";
import {
  RENTAL_COMMON_WORKFLOWS,
  RENTAL_DAILY_WORKFLOW,
  RENTAL_FUNCTION_HELP,
  RENTAL_HELP_GROUPS,
  getRentalFunctionHelp,
} from "./rentalHelpContent";

export default function RentalHelpModal({ activeFunctionId, onClose }) {
  const current = getRentalFunctionHelp(activeFunctionId);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-5"
      onClick={onClose}
      data-rental-help
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rental-help-title"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-950 shadow-2xl dark:bg-slate-900 dark:text-slate-100 sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400">
              Rental Manager Help
            </p>
            <h2 id="rental-help-title" className="mt-1 text-2xl font-black">
              Workflows and button guide
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Start with the section you are viewing, then use the daily routine or a common task guide.
              Review names, dates, amounts, and record context before confirming consequential actions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950">
          <p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">
            You are viewing
          </p>
          <h3 className="mt-1 text-lg font-black">{current.title}</h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{current.summary}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            {current.actions.map((action) => <li key={action}>{action}</li>)}
          </ol>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Daily operating routine
          </h3>
          <ol className="mt-3 grid gap-2 md:grid-cols-2">
            {RENTAL_DAILY_WORKFLOW.map((step, index) => (
              <li key={step} className="flex gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white dark:bg-amber-400 dark:text-slate-950">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-7">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            How do I...
          </h3>
          <div className="mt-3 space-y-3">
            {RENTAL_COMMON_WORKFLOWS.map((workflow) => (
              <details key={workflow.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <summary className="cursor-pointer font-black">{workflow.title}</summary>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  {workflow.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            What each section is for
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {RENTAL_HELP_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h4 className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
                  {group.title}
                </h4>
                <dl className="mt-3 space-y-3">
                  {group.ids.map((id) => {
                    const item = RENTAL_FUNCTION_HELP[id];
                    return (
                      <div key={id}>
                        <dt className="text-sm font-black">{item.title}</dt>
                        <dd className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.summary}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-7 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          When something does not match the lease, provider evidence, or actual field condition, stop and review it.
          Do not create a second transaction, overwrite history, or guess just to clear an exception.
        </p>
      </div>
    </div>
  );
}
