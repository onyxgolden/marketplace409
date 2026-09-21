"use client";
import PrivateFinancingAccountsPanel from "@/components/forge/rental/PrivateFinancingAccountsPanel";

// Standalone Private Financing workspace: the borrower-accounts surface promoted out of
// Rental Manager's shell (owner-approved 2026-09-21). The panel component itself is unchanged.
export default function PrivateFinancingPageClient() {
  return (
    <section data-private-financing-application-shell className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950">
      <header className="border-b border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 text-slate-950 dark:text-slate-100 lg:px-8">
        <div className="mx-auto max-w-[1800px]">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">FORGE Application</p>
          <h1 className="text-2xl font-black tracking-tight">Private Financing</h1>
        </div>
      </header>
      <div className="mx-auto max-w-[1800px] p-4 lg:p-8">
        <PrivateFinancingAccountsPanel />
      </div>
    </section>
  );
}
