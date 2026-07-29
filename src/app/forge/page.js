import { redirect } from "next/navigation";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import ForgeNavigationBar from "@/components/forge/ForgeNavigationBar";
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
        <ForgeNavigationBar />
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
