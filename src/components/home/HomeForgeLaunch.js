import Link from "next/link";

export default function HomeForgeLaunch() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-6">
      <div className="overflow-hidden rounded-3xl border border-slate-300 bg-white shadow-xl">
        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-6 md:p-8">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-amber-700">
              ⚒ Powered by FORGE
            </div>

            <h2 className="mt-5 text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
              Financial operating system for 409 Marketplace.
            </h2>

            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
              Track net worth, monitor audit risk, review executive intelligence,
              and prepare future bank, credit card, Plaid, and Stripe connections
              from one command center.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/forge"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-slate-800"
              >
                Launch FORGE →
              </Link>

              <Link
                href="/forge/financial"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-950 bg-white px-6 py-3 text-sm font-black uppercase tracking-wide text-slate-950 shadow-sm transition hover:bg-slate-100"
              >
                Executive KPI Dashboard →
              </Link>

              <Link
                href="/import"
                className="inline-flex items-center justify-center rounded-2xl border border-amber-400 bg-amber-50 px-6 py-3 text-sm font-black uppercase tracking-wide text-amber-800 shadow-sm transition hover:bg-amber-100"
              >
                Financial Import →
              </Link>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-600">
                Preview workspace · Under active development
              </div>
            </div>
          </div>

          <div className="relative min-h-64 bg-[linear-gradient(135deg,#020617_0%,#111827_28%,#475569_52%,#0f172a_78%,#020617_100%)] p-6 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(245,158,11,0.35),transparent_35%)]" />

            <div className="relative flex h-full flex-col justify-between rounded-3xl border border-white/15 bg-black/20 p-6 shadow-inner">
              <div>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-slate-200 via-slate-500 to-slate-950 text-3xl shadow-lg">
                  ⚒
                </div>

                <div className="mt-5 text-sm font-black uppercase tracking-[0.28em] text-amber-400">
                  Executive Command
                </div>

                <div className="mt-2 text-4xl font-black tracking-[0.12em]">
                  FORGE
                </div>
              </div>

              <div className="mt-8 grid gap-3">
                {["Net Worth", "Risk Center", "Audit Layer"].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
