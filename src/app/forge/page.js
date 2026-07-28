import Link from "next/link";
import { redirect } from "next/navigation";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const dynamic = "force-dynamic";

export default async function ForgePage() {
  const forgeApplication =
    await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    redirect("/auth");
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();

  const canonicalIntelligenceContext =
    await forgeApplicationSuite
      .canonicalIntelligenceContextBuilder
      .build({
        ownerId: forgeApplication.user.id,
      });

  const initialDashboardIntelligence =
    forgeApplicationSuite.forgeDashboardApplication
      .normalizeDashboardIntelligence(
        typeof canonicalIntelligenceContext?.toJSON === "function"
          ? canonicalIntelligenceContext.toJSON()
          : canonicalIntelligenceContext,
      );

  const readModelApplication =
    forgeApplicationSuite.financialReadModelApplication;

  const [
    business,
    investor,
    kpi,
    executive,
  ] = await Promise.all([
    readModelApplication.buildBusinessDashboard(),
    readModelApplication.buildInvestorDashboard(),
    readModelApplication.buildKPIModel(),
    readModelApplication.buildExecutiveSummary(),
  ]);

  const initialReadModels = {
    financial: null,
    business,
    investor,
    kpi,
    executive,
    decisionOutcome: null,
  };

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
            href="/forge/connections"
            className="inline-flex items-center justify-center rounded-2xl border border-blue-300 bg-blue-50 px-5 py-3 text-sm font-black uppercase tracking-wide text-blue-800 transition hover:bg-blue-100"
          >
            Connection Platform →
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
        initialDashboardIntelligence={
          JSON.parse(
            JSON.stringify(
              initialDashboardIntelligence,
            ),
          )
        }
        initialReadModels={
          JSON.parse(
            JSON.stringify(
              initialReadModels,
            ),
          )
        }
      />
    </div>
  );
}
