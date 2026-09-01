"use client";

import { useState } from "react";
import Link from "next/link";

const spanClasses = {
  standard: "",
  wide: "xl:col-span-2",
};

export default function ForgeWorkspaceTile({
  eyebrow,
  title,
  detail,
  href,
  actionLabel = "Open workspace",
  status,
  span = "standard",
  children,
  expandedChildren = null,
  expandLabel = "Expand",
  collapseLabel = "Collapse",
  initialExpanded = false,
}) {
  const [expanded, setExpanded] = useState(
    Boolean(initialExpanded && expandedChildren),
  );
  const expandable = Boolean(expandedChildren);

  const tileSpanClass = expanded
    ? "md:col-span-2"
    : spanClasses[span] ?? "";

  return (
    <section
      data-workspace-tile
      data-workspace-tile-expanded={expanded}
      className={`flex min-h-[320px] flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${tileSpanClass}`}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && (
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              {eyebrow}
            </div>
          )}

          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">{title}</h2>

          {detail && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {detail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {status && (
            <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {status}
            </div>
          )}

          {expandable && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-slate-950 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:text-white"
            >
              {expanded ? collapseLabel : expandLabel}
            </button>
          )}
        </div>
      </header>

      <div className="mt-6 flex-1">
        {expanded ? expandedChildren : children}
      </div>

      {href && (
        <footer className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Link
            href={href}
            className="inline-flex rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
          >
            {actionLabel}
          </Link>
        </footer>
      )}
    </section>
  );
}
