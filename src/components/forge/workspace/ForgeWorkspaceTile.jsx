import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Simple name card for the application chooser: just the application name,
// tappable to open it. No preview surfaces, no expandable content.
export default function ForgeWorkspaceTile({ title, href }) {
  const card = (
    <span className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <span className="text-xl font-black text-slate-950 dark:text-white">
        {title}
      </span>
      {href ? (
        <ArrowRight
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-slate-400"
        />
      ) : null}
    </span>
  );

  if (!href) {
    return <div data-workspace-tile>{card}</div>;
  }

  return (
    <Link href={href} data-workspace-tile className="block">
      {card}
    </Link>
  );
}
