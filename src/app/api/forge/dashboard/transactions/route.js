import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  SupabaseDashboardFinancialTransactionsRepository,
} from "@/domains/financial-event/SupabaseDashboardFinancialTransactionsRepository.js";
import {
  buildDiagnosticPage,
  parseDiagnosticPageParams,
} from "./transactionDiagnostics.js";

// Slice 3 (load-times): on-demand full-history diagnostic for the
// /forge dashboard. The initial dashboard ships summary totals only
// (transactionsStatus: "not-loaded"); expanding the diagnostic layer
// loads the ENTIRE original transaction list through this endpoint --
// all dates, stable event_date,id order, the aggregation service's
// record shape -- in pages, until every page is loaded.
//
// Fix round (diagnostic endpoint): the route used to rebuild the
// owner's ENTIRE history on EVERY page request -- the legacy repository
// fetched all 11,776 events in twelve sequential 1,000-row pages, then
// the JS aggregation service re-aggregated the whole set, just to serve
// one 1,000-row page. That full rebuild per page exceeded the Vercel
// Hobby function time budget in production (the endpoint failed
// deterministically, on the initial load and on retry). The route now
// serves one page per request from the
// forge_dashboard_financial_transactions_v1 RPC: one DB-side query over
// the same eligible set, same rows, same order, same record shape --
// only fetched one page at a time. The legacy full-history repository
// is untouched and still serves the Financial Transactions page and
// every other caller.
// HTTP responses stay private/non-cacheable, and a failure is a 500 --
// never a fabricated empty history.
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();

    if (authenticated.response) return authenticated.response;

    const { page, pageSize } = parseDiagnosticPageParams(
      new URL(request.url).searchParams,
    );

    const transactionsRepository =
      new SupabaseDashboardFinancialTransactionsRepository({
        supabaseClient: authenticated.supabaseClient,
      });

    // Business scope, matching the dashboard's original list: the
    // read-model layer defaults the /forge workspace to business.
    const pageResult = await transactionsRepository.getPage({
      ownerId: authenticated.effectiveOwnerId,
      scope: "business",
      page,
      pageSize,
    });

    return NextResponse.json(
      buildDiagnosticPage({
        pageResult,
        page,
        pageSize,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Dashboard transaction history error", error);

    const status = error?.status === 400 ? 400 : 500;

    return NextResponse.json(
      {
        error:
          status === 400
            ? error.message
            : "Unable to load transaction history.",
      },
      { status, headers: NO_STORE },
    );
  }
}
