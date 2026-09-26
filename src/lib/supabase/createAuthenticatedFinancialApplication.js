import {
  NextResponse,
} from "next/server";

import {
  createFinancialApplicationSuite,
} from "@/infrastructure/composition/createFinancialApplicationSuite.js";

import {
  createFinancialEventRepository,
} from "@/infrastructure/composition/createFinancialEventRepository.js";

import {
  ProductionFinancialDataProvider,
} from "@/domains/ledger/providers/ProductionFinancialDataProvider.js";

import {
  FinancialDashboardService,
} from "@/domains/ledger/dashboard/FinancialDashboardService.js";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  resolveEffectiveOwnerId,
} from "@/lib/supabase/resolveEffectiveOwnerId";

export async function createAuthenticatedFinancialApplication() {
  const supabaseClient = await createClient();

  const {
    data: {
      user,
    },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError || !user?.id) {
    return {
      response: NextResponse.json(
        {
          error:
            "Authenticated owner id is required.",
        },
        {
          status: 401,
        },
      ),
    };
  }

  const effectiveOwnerId = await resolveEffectiveOwnerId({
    supabaseClient,
    actorUserId: user.id,
  });

  const currentOwnerId = async () => effectiveOwnerId;

  let financialApplicationSuite;

  async function getFinancialApplicationSuite() {
    if (!financialApplicationSuite) {
      // Real ledger wiring for the reporting composition: the suite accepts ledger inputs
      // (generalLedger/chartOfAccounts, or a resolved financialData object) but the
      // authenticated production path never supplied them, so engine/reportingApplication were
      // always null and every reports/ask/snapshot route returned 503. Build them here from
      // the owner's real financial_events rows -- never demo, seeded, or invented data.
      // The repository instance is shared with the suite (passed through deps) so the events
      // are fetched once per request, through the same storage backend and RLS-bound client
      // the financial workspace already reads through.
      const financialEventRepository =
        await createFinancialEventRepository({ supabaseClient });

      let financialData = null;

      try {
        const events =
          await financialEventRepository.findByOwnerId(effectiveOwnerId);

        financialData = new ProductionFinancialDataProvider({
          events,
        }).getFinancialData();
      } catch (error) {
        // A transient read failure stays on the deliberate 503 "temporarily unavailable"
        // contract (with the UI's retry) rather than 500ing or, worse, reporting zeros as
        // though they were real balances. The provider's mapper never throws on malformed
        // rows -- it skips them -- so reaching here means the read itself failed.
        console.error(
          "[financial] failed to load financial events for reporting",
          error,
        );
      }

      financialApplicationSuite =
        await createFinancialApplicationSuite({
          supabaseClient,
          ownerId: effectiveOwnerId,
          currentOwnerId,
          financialEventRepository,
          financialData,
          // The dashboard metadata must name the real data source: with real ledger
          // inputs flowing, the service's default "demo" label would be a lie in the
          // API payload, and its revenue/expense math now aggregates by account sign
          // so the real per-category accounts total correctly.
          dashboardService: new FinancialDashboardService({
            provider: "production",
          }),
        });
    }

    return financialApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    effectiveOwnerId,
    currentOwnerId,
    getFinancialApplicationSuite,
  };
}
