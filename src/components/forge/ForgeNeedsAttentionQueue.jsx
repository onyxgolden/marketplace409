"use client";
import { AlertTriangle, ArrowRight, CircleAlert, Info, PartyPopper } from "lucide-react";

// Ordered "what needs a decision next" queue for a FORGE workspace summary. Severity is data,
// not decoration: each item already carries the urgency ranking computed by the caller's pure
// domain summary — this component only renders it. Reusable outside Rental Manager.
const SEVERITY_STYLES = {
  critical: { icon: AlertTriangle, dot: "bg-red-600", label: "text-red-700 dark:text-red-400" },
  warning: { icon: CircleAlert, dot: "bg-amber-500", label: "text-amber-700 dark:text-amber-400" },
  info: { icon: Info, dot: "bg-sky-500", label: "text-sky-700 dark:text-sky-400" },
};

export default function ForgeNeedsAttentionQueue({ items = [], onNavigate, emptyMessage = "Nothing needs your attention right now." }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        <PartyPopper size={20} aria-hidden="true" />
        <p className="text-sm font-bold">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-2" data-needs-attention-queue>
      {items.map((item, index) => {
        const style = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info;
        const Icon = style.icon;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate?.(item.destination)}
              data-attention-item={item.id}
              className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-slate-400" aria-hidden="true">
                {index + 1}
              </span>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.dot} text-white`} aria-hidden="true">
                <Icon size={16} strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-xs font-black uppercase tracking-wide ${style.label}`}>{item.severity}</span>
                <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{item.label}</span>
                {item.detail ? <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{item.detail}</span> : null}
              </span>
              <ArrowRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
