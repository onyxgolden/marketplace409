import Link from "next/link";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const dynamic = "force-dynamic";

export default async function ForgePage() {
  const forgeApplication =
    await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    return forgeApplication.response;
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();
  return (
    <div>
      <section className="mx-auto max-w-[1600px] px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="flex flex-wrap gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <Link
            href="/forge/financial"
            className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black uppercase tracking-wide text-white transition hover:bg-slate-800"
          >
            Executive KPI Dashboard →
          </Link>

          <Link
            href="/import"
            className="inline-flex items-center justify-center rounded-2xl border border-amber-400 bg-amber-50 px-5 py-3 text-sm font-black uppercase tracking-wide text-amber-800 transition hover:bg-amber-100"
          >
            Financial Import →
          </Link>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-50"
          >
            ← Home
          </Link>
        </div>
      </section>

      <ForgeDashboardClient
        forgeDashboardApplication={
          forgeApplicationSuite.forgeDashboardApplication
        }
      />
    </div>
  );
}
