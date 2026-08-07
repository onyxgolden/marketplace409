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
      className={`flex min-h-[320px] flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ${tileSpanClass}`}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && (
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              {eyebrow}
            </div>
          )}

          <h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>

          {detail && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              {detail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {status && (
            <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600">
              {status}
            </div>
          )}

          {expandable && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
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
        <footer className="mt-6 border-t border-slate-200 pt-4">
          <Link
            href={href}
            className="inline-flex rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800"
          >
            {actionLabel}
          </Link>
        </footer>
      )}
    </section>
  );
}
