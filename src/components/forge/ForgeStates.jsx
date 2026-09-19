// ForgeStates: the shared loading / empty / error states for every FORGE
// surface. Every panel used to hand-roll its own "Loading…", red error box,
// and "nothing here yet" copy; they now share one visual language built on
// the forgeTheme tokens. Pure presentation -- no I/O, no LLM calls.
//
// Loading renders a skeleton + label with role="status" (never a silent
// blank). Errors use role="alert" and always keep the raw detail visible so
// a user can report it. Empty states are honest: a headline, one line of
// guidance, and an optional action -- never a fabricated zero.
import Link from "next/link";
import { forgeTheme } from "@/components/forge/theme";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const RETRY_BUTTON =
  `mt-4 rounded-xl border border-red-400 px-4 py-2 text-sm font-bold text-red-800 transition hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40 ${FOCUS_RING}`;

const ACTION_BUTTON =
  `mt-4 inline-block rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:opacity-90 dark:bg-amber-400 dark:text-slate-950 ${FOCUS_RING}`;

/**
 * ForgeLoadingState -- one skeleton/spinner pattern for every FORGE surface.
 * `label` is announced to screen readers via role="status".
 */
export function ForgeLoadingState({ label }) {
  return (
    <section className={forgeTheme.card}>
      <div aria-hidden="true" className="animate-pulse space-y-2">
        <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-3/5 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <p role="status" className={`mt-4 ${forgeTheme.textSmall}`}>
        {label}
      </p>
    </section>
  );
}

/**
 * ForgeEmptyState -- one "nothing here yet" pattern. Honest headline, one
 * line of guidance, optional action (href link or onAction handler).
 */
export function ForgeEmptyState({
  headline,
  guidance = null,
  actionHref = null,
  actionLabel = null,
  onAction = null,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
        {headline}
      </p>
      {guidance ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {guidance}
        </p>
      ) : null}
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={ACTION_BUTTON}>
          {actionLabel}
        </Link>
      ) : null}
      {!actionHref && onAction && actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className={ACTION_BUTTON}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * ForgeErrorState -- one load-failure pattern (the red section already used
 * on the financial overview). Title + detail with role="alert", plus an
 * optional retry slot.
 */
export function ForgeErrorState({
  title,
  detail = null,
  onRetry = null,
  retryLabel = "Retry",
}) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
      <div role="alert" className="font-black">
        {title}
      </div>
      {detail ? <div className="mt-2 text-sm">{detail}</div> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className={RETRY_BUTTON}>
          {retryLabel}
        </button>
      ) : null}
    </section>
  );
}
