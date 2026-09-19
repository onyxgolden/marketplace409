// StatusTimeline: a shared progress-timeline presentation for lifecycle states that
// already live in the data -- financing accounts, reservation bookings, signature
// rounds. Pure presentation: it renders whatever `steps` it is given and never
// derives, invents, or re-labels a stage. Each step is
// { label, state: "complete" | "current" | "upcoming" | "failed", detail?, ariaCurrent? }.
// "complete" = a stage the data shows as passed. "current" = where the record sits now.
// "upcoming" = a later stage that has not happened. "failed" = a terminal stage that
// ended the lifecycle early (cancelled, expired, written off). Steps the data does not
// have simply are not passed in -- no invented "applied" or "funded" stages.
import { forgeTheme } from "@/components/forge/theme";

const DOT = {
  complete: "bg-emerald-600 text-white dark:bg-emerald-500",
  current: "bg-sky-700 text-white dark:bg-sky-500",
  upcoming: "border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900",
  failed: "bg-rose-600 text-white dark:bg-rose-500",
};

const LABEL = {
  complete: "text-slate-950 dark:text-white",
  current: "text-slate-950 dark:text-white",
  upcoming: "text-slate-500 dark:text-slate-400",
  failed: "text-slate-950 dark:text-white",
};

const CHECK = (
  <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
    <path d="M2 6.5 4.8 9.3 10 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CROSS = (
  <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
    <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/**
 * StatusTimeline -- vertical progress timeline for a known lifecycle.
 * `heading` labels the timeline region; `steps` is the honest step list from a
 * domain helper (see domains/reservations/lifecycleTimeline.js and
 * domains/private-financing/lifecycleTimeline.js).
 */
export default function StatusTimeline({ heading, steps = [] }) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return (
    <section aria-label={heading} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-200">{heading}</h3>
      <ol className="mt-4 space-y-0">
        {steps.map((step, index) => {
          const state = DOT[step.state] ? step.state : "upcoming";
          const last = index === steps.length - 1;
          return (
            <li key={step.label ?? index} className="relative flex gap-3" {...(state === "current" ? { "aria-current": "step" } : {})}>
              <span className="flex flex-col items-center">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${DOT[state]}`}>
                  {state === "complete" ? CHECK : state === "failed" ? CROSS : state === "current" ? <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" /> : null}
                </span>
                {!last && <span aria-hidden="true" className={`w-0.5 flex-1 ${state === "complete" ? "bg-emerald-500" : state === "failed" ? "bg-rose-400" : "bg-slate-200 dark:bg-slate-700"}`} style={{ minHeight: "1.25rem" }} />}
              </span>
              <div className={`pb-5 ${last ? "pb-0" : ""}`}>
                <p className={`font-black ${LABEL[state]}`}>{step.label}</p>
                {step.detail ? <p className={`mt-0.5 ${forgeTheme.textSmall}`}>{step.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
