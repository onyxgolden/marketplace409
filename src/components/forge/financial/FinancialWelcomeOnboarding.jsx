"use client";
import StripeFinancialConnectionsButton from "@/components/forge/StripeFinancialConnectionsButton";

// Shown on Financial FORGE's Overview instead of the normal (all-zero) dashboard stack whenever the
// workspace has zero financial_accounts -- a genuinely new workspace, never a loading or stale-cache
// state (see page.js: gated on loadState === "ready" && accounts.length === 0). A blank dashboard of
// $0.00 KPIs and "no data" charts reads as broken, not new -- this replaces that with a direct path
// to real data instead.
export default function FinancialWelcomeOnboarding({ onNavigateToImport }) {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
          Welcome to Financial FORGE
        </div>

        <p className="mt-2 text-lg font-black text-slate-950 dark:text-slate-50">
          Connect an account to see your real net worth, cash flow, and property performance here.
        </p>

        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Nothing is connected yet, so there is nothing to show -- once an account is linked, this
          page becomes your live financial dashboard.
        </p>
      </div>

      <StripeFinancialConnectionsButton />

      <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        <p>
          Already have your data in Quicken Simplifi?{" "}
          <button
            type="button"
            onClick={onNavigateToImport}
            className="font-black text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
          >
            Import a CSV instead
          </button>
          .
        </p>

        <p className="mt-2">
          You can also add a single account by hand from the Accounts panel on the left.
        </p>
      </div>
    </div>
  );
}
