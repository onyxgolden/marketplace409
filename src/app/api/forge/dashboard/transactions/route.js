import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  buildDiagnosticPage,
  parseDiagnosticPageParams,
} from "./transactionDiagnostics.js";

// Slice 3 (load-times): on-demand full-history diagnostic for the
// /forge dashboard. The initial dashboard ships summary totals only
// (transactionsStatus: "not-loaded"); expanding the diagnostic layer
// loads the ENTIRE original transaction list through this endpoint --
// all dates, stable event_date,id order, the aggregation service's
// record shape -- in pages, until every page is loaded. The route uses
// the legacy full-history workspace build (unchanged), so the list it
// serves is byte-for-byte the list the pre-Slice-3 dashboard embedded.
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

    const forgeApplicationSuite =
      await authenticated.getForgeApplicationSuite();

    // Business scope, matching the dashboard's original list: the
    // read-model layer defaults the /forge workspace to business.
    const workspace =
      await forgeApplicationSuite.financialWorkspaceQueryService.buildWorkspace(
        authenticated.effectiveOwnerId,
        { scope: "business" },
      );

    return NextResponse.json(
      buildDiagnosticPage({
        transactions: workspace.transactions,
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
