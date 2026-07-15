import Link from "next/link";

import Header from "@/components/Header";
import FinancialImportTool from "./FinancialImportTool";

export default function ImportPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <div className="mx-auto max-w-7xl px-4 pt-6">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        >
          ← Back to Home
        </Link>

        <div className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-amber-700">
            🚧 Preview Release
          </div>

          <h1 className="mt-2 text-2xl font-black text-slate-900">
            FORGE Financial Workspace
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
            You're viewing an active production preview of the FORGE financial platform.
            Core financial imports and persistence are operational, while live bank
            synchronization, executive dashboards, portfolio analytics, and forecasting
            are still under development.
          </p>

          <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-green-100 px-3 py-2 text-green-800">
              ✓ Rentec Imports
            </span>
            <span className="rounded-full bg-green-100 px-3 py-2 text-green-800">
              ✓ Transaction Review
            </span>
            <span className="rounded-full bg-green-100 px-3 py-2 text-green-800">
              ✓ Financial Persistence
            </span>
            <span className="rounded-full bg-amber-200 px-3 py-2 text-amber-900">
              Next: Live Plaid Sync
            </span>
            <span className="rounded-full bg-amber-200 px-3 py-2 text-amber-900">
              Executive Dashboards
            </span>
          </div>
        </div>
      </div>

      <FinancialImportTool />
    </main>
  );
}
