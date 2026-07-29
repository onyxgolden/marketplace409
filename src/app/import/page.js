import Header from "@/components/Header";
import ForgeNavigationBar from "@/components/forge/ForgeNavigationBar";
import FinancialImportTool from "./FinancialImportTool";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export default async function ImportPage() {
  const forgeApplication =
    await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    return forgeApplication.response;
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <div className="mx-auto max-w-7xl px-4 pt-6">
        <ForgeNavigationBar />

        <div className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-amber-700">
            🚧 Preview Release
          </div>

          <h1 className="mt-2 text-2xl font-black text-slate-900">
            FORGE Financial Workspace
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
            You&apos;re viewing an active production preview of the FORGE financial platform.
            Core financial imports and persistence are operational, while live bank
            synchronization, advanced portfolio analytics, and forecasting
            are still under development. The Executive KPI Dashboard is now available.
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
            <span className="rounded-full bg-green-100 px-3 py-2 text-green-800">
              ✓ Executive KPI Dashboard
            </span>
          </div>
        </div>
      </div>

      <FinancialImportTool />
    </main>
  );
}
