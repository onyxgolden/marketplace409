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
}) {
  return (
    <section
      className={`flex min-h-[320px] flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ${spanClasses[span] ?? ""}`}
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

        {status && (
          <div className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600">
            {status}
          </div>
        )}
      </header>

      <div className="mt-6 flex-1">{children}</div>

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
