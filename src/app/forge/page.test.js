import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Slice 3 fix round 1 (ChatGPT NEEDS CHANGES at c7cc2e30, PR #823):
// the /forge page used to call buildDashboardSummaryWorkspace with the
// ACTOR's user id, so a co-owner viewing the primary owner's shared
// workspace issued a second summary RPC under the actor's id and the
// page could render a 200 mixing owners' data. These tests drive the
// REAL page module -- real FinancialReadModelApplication, real
// FinancialWorkspaceQueryService, real adapter, real canonical
// intelligence builder -- with stubbed repositories, and assert the
// whole initial dashboard comes from ONE owner: the validated
// effective owner. The legacy full-history repository is wired to
// throw if anything calls it, so a scan fails the test outright.

const mocks = vi.hoisted(() => ({
  createAuthenticatedForgeApplication: vi.fn(),
  isOwnerOrActiveCoOwner: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/components/forge/ForgeDashboardClient", () => ({
  // A function component may return a string; rendering it proves the
  // page's props survive the JSON round-trip and reach the client.
  default: ({ initialReadModels }) =>
    [
      `workspace-income:${initialReadModels.workspace?.portfolio?.income}`,
      `property:${initialReadModels.workspace?.properties?.[0]?.name}`,
      `category:${initialReadModels.workspace?.categories?.[0]?.name}`,
      `business-revenue:${initialReadModels.businessDashboard?.dashboard?.kpis?.revenue}`,
      `investor-revenue:${initialReadModels.investorDashboard?.kpis?.revenue}`,
      `kpi-revenue:${initialReadModels.kpiModel?.kpis?.revenue}`,
      `health:${initialReadModels.executiveSummary?.health?.label}`,
      `owner:${initialReadModels.ownerId}`,
      `co-owner:${initialReadModels.isOwnerOrCoOwner}`,
    ].join("|"),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: mocks.isOwnerOrActiveCoOwner,
}));

import ForgePage from "./page.jsx";
import { FinancialReadModelApplication } from "@/application/financial/read-models/FinancialReadModelApplication.js";
import { FinancialWorkspaceQueryService } from "@/application/financial/FinancialWorkspaceQueryService.js";
import { financialWorkspaceReadModelAdapter } from "@/application/financial/read-models/FinancialWorkspaceReadModelAdapter.js";
import { CanonicalIntelligenceContextBuilder } from "@/application/intelligence/CanonicalIntelligenceContextBuilder.js";
import { FinancialIntelligenceApplication } from "@/application/financial/FinancialIntelligenceApplication.js";
import { ForgeDashboardApplication } from "@/application/financial/ForgeDashboardApplication.js";

// Distinct seeded totals per owner, so a test can tell whose data is
// on the page: the primary owner's numbers are profitable (Healthy),
// the actor's own numbers lose money (Critical).
function summaryForOwner({
  income,
  expenses,
  noi,
  cashFlow,
  transactionCount,
  propertyName,
  categoryName,
}) {
  return Object.freeze({
    portfolio: Object.freeze({
      income,
      expenses,
      noi,
      cashFlow,
      transactionCount,
    }),
    properties: Object.freeze([
      Object.freeze({
        id: `prop-${propertyName}`,
        name: propertyName,
        income,
      }),
    ]),
    categories: Object.freeze([
      Object.freeze({
        id: `cat-${categoryName}`,
        name: categoryName,
      }),
    ]),
    version: "forge_dashboard_financial_summary_v1",
    scope: "business",
  });
}

const PRIMARY_SUMMARY = summaryForOwner({
  income: 1500,
  expenses: 250,
  noi: 1250,
  cashFlow: 1250,
  transactionCount: 2,
  propertyName: "Primary Property",
  categoryName: "Primary Category",
});

const ACTOR_SUMMARY = summaryForOwner({
  income: 700,
  expenses: 800,
  noi: -100,
  cashFlow: -100,
  transactionCount: 1,
  propertyName: "Actor Property",
  categoryName: "Actor Category",
});

describe("ForgePage -- dashboard summary owner (Slice 3 fix round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function configurePage({
    actorId,
    effectiveOwnerId,
    isOwnerOrCoOwner,
  }) {
    // The SQL summary RPC, stubbed per owner: records every call so
    // the test can prove exactly one call for the effective owner.
    const getSummary = vi.fn(async ({ ownerId }) => {
      if (ownerId === "primary-owner") return PRIMARY_SUMMARY;
      if (
        ownerId === "co-owner-actor" ||
        ownerId === "former-co-owner"
      ) {
        return ACTOR_SUMMARY;
      }
      if (ownerId === "owner-1") return PRIMARY_SUMMARY;
      throw new Error(`No seeded summary for owner ${ownerId}`);
    });

    // The legacy full-history scan: any call is a failure, not a
    // fallback -- the summary path must never reach it on /forge.
    const findByOwnerId = vi.fn(async () => {
      throw new Error(
        "legacy full-history scan must never run on /forge",
      );
    });

    const readModelApplication = new FinancialReadModelApplication({
      financialWorkspaceQueryService:
        new FinancialWorkspaceQueryService({
          financialEventRepository: { findByOwnerId },
          dashboardFinancialSummaryRepository: {
            getSummary,
          },
        }),
      readModelAdapter: financialWorkspaceReadModelAdapter,
      currentOwnerId: async () => effectiveOwnerId,
    });

    const financialIntelligenceApplication =
      new FinancialIntelligenceApplication({
        readModelApplication,
        trendAnalysisService: {
          analyze: (kpis) => ({ revenue: kpis.revenue }),
        },
        scenarioModelingService: {
          model: (kpis) => ({ revenue: kpis.revenue }),
        },
        forecastService: {
          forecast: (kpis) => ({ revenue: kpis.revenue }),
        },
        recommendationService: { recommend: () => [] },
        planningService: { buildPlan: () => ({}) },
      });

    const buildFinancialIntelligence = vi.spyOn(
      financialIntelligenceApplication,
      "buildFinancialIntelligence",
    );

    const getExecutionHistoryIntelligence = vi.fn(async () => ({
      totalExecutions: 0,
    }));

    const canonicalIntelligenceContextBuilder =
      new CanonicalIntelligenceContextBuilder({
        financialReadModelApplication: readModelApplication,
        financialIntelligenceApplication,
        connectionOperationsApplication: {
          buildExecutionIntelligence: () => ({
            status: "successful",
          }),
          getExecutionHistoryIntelligence,
        },
      });

    mocks.createAuthenticatedForgeApplication.mockResolvedValue({
      user: { id: actorId },
      effectiveOwnerId,
      supabaseClient: {},
      getForgeApplicationSuite: async () => ({
        financialReadModelApplication: readModelApplication,
        canonicalIntelligenceContextBuilder,
        forgeDashboardApplication: ForgeDashboardApplication,
        // Production shape: no transaction-review projection service
        // is wired on /forge, so the queue stays null.
        transactionReviewQueryService: null,
        transactionReviewReadModelAdapter: null,
      }),
    });

    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(
      isOwnerOrCoOwner,
    );

    return {
      getSummary,
      findByOwnerId,
      buildFinancialIntelligence,
      getExecutionHistoryIntelligence,
    };
  }

  test("co-owner viewing the primary owner's workspace sees only the primary owner's data, one RPC", async () => {
    const {
      getSummary,
      findByOwnerId,
      buildFinancialIntelligence,
      getExecutionHistoryIntelligence,
    } = configurePage({
      actorId: "co-owner-actor",
      effectiveOwnerId: "primary-owner",
      isOwnerOrCoOwner: true,
    });

    const element = await ForgePage();
    const { initialReadModels } = element.props;

    expect(mocks.redirect).not.toHaveBeenCalled();

    // Exactly one summary RPC, for the selected effective owner and
    // the business scope -- never one per tile, never one per owner.
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith({
      ownerId: "primary-owner",
      scope: "business",
    });

    // No full-history repository scan anywhere in the page call graph.
    expect(findByOwnerId).not.toHaveBeenCalled();

    // Workspace AND every KPI/business/investor/health output use the
    // primary owner's totals, not the actor's.
    expect(initialReadModels.workspace.portfolio.income).toBe(1500);
    expect(
      initialReadModels.workspace.properties[0].name,
    ).toBe("Primary Property");
    expect(
      initialReadModels.workspace.categories[0].name,
    ).toBe("Primary Category");
    expect(initialReadModels.workspace.transactionsStatus).toBe(
      "not-loaded",
    );
    expect(
      initialReadModels.businessDashboard.dashboard.kpis.revenue,
    ).toBe(1500);
    expect(
      initialReadModels.businessDashboard.reports.portfolio.income,
    ).toBe(1500);
    expect(initialReadModels.investorDashboard.kpis.revenue).toBe(
      1500,
    );
    expect(initialReadModels.kpiModel.kpis.revenue).toBe(1500);
    expect(initialReadModels.kpiModel.kpis.profit).toBe(1250);
    expect(initialReadModels.executiveSummary.health.label).toBe(
      "Healthy",
    );

    // The actor's own numbers appear nowhere on the rendered page.
    expect(JSON.stringify(element.props)).not.toContain(
      "Actor Property",
    );
    expect(JSON.stringify(element.props)).not.toContain(
      "Actor Category",
    );

    // The intelligence path reused the same effective-owner summary.
    expect(buildFinancialIntelligence).toHaveBeenCalledTimes(1);
    const intelligenceDashboard =
      buildFinancialIntelligence.mock.calls[0][0].dashboard;
    expect(intelligenceDashboard.workspace.portfolio.income).toBe(
      1500,
    );
    expect(intelligenceDashboard.dashboard.kpis.revenue).toBe(1500);

    // The actor identity is preserved separately, for actor-specific
    // UI only: the Health-tile gate and the connection history see
    // the actor, never the effective owner.
    expect(mocks.isOwnerOrActiveCoOwner).toHaveBeenCalledWith({
      supabaseClient: expect.anything(),
      actorUserId: "co-owner-actor",
    });
    expect(getExecutionHistoryIntelligence).toHaveBeenCalledWith({
      ownerId: "co-owner-actor",
      connectionId: undefined,
    });
    expect(initialReadModels.ownerId).toBe("co-owner-actor");
    expect(initialReadModels.isOwnerOrCoOwner).toBe(true);

    // The rendered client receives the primary owner's numbers.
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("workspace-income:1500");
    expect(markup).toContain("property:Primary Property");
    expect(markup).toContain("category:Primary Category");
    expect(markup).toContain("business-revenue:1500");
    expect(markup).toContain("investor-revenue:1500");
    expect(markup).toContain("kpi-revenue:1500");
    expect(markup).toContain("health:Healthy");
    expect(markup).not.toContain("Actor Property");
  });

  test("owner=self baseline: one RPC for the owner's own workspace", async () => {
    const { getSummary, findByOwnerId } = configurePage({
      actorId: "owner-1",
      effectiveOwnerId: "owner-1",
      isOwnerOrCoOwner: true,
    });

    const element = await ForgePage();
    const { initialReadModels } = element.props;

    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith({
      ownerId: "owner-1",
      scope: "business",
    });
    expect(findByOwnerId).not.toHaveBeenCalled();
    expect(initialReadModels.workspace.portfolio.income).toBe(1500);
    expect(initialReadModels.kpiModel.kpis.revenue).toBe(1500);
    expect(initialReadModels.executiveSummary.health.label).toBe(
      "Healthy",
    );
    expect(initialReadModels.ownerId).toBe("owner-1");

    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("workspace-income:1500");
    expect(markup).toContain("health:Healthy");
  });

  test("denied/revoked co-owner falls back to their own workspace, never the primary's", async () => {
    // resolveEffectiveOwnerId returns the actor's own id once the
    // membership is revoked (no active membership); the page must
    // then show the actor's own numbers and never call the RPC for
    // the primary owner it no longer has access to.
    const { getSummary, findByOwnerId } = configurePage({
      actorId: "former-co-owner",
      effectiveOwnerId: "former-co-owner",
      isOwnerOrCoOwner: false,
    });

    const element = await ForgePage();
    const { initialReadModels } = element.props;

    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith({
      ownerId: "former-co-owner",
      scope: "business",
    });
    expect(getSummary).not.toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "primary-owner" }),
    );
    expect(findByOwnerId).not.toHaveBeenCalled();

    expect(initialReadModels.workspace.portfolio.income).toBe(700);
    expect(
      initialReadModels.workspace.properties[0].name,
    ).toBe("Actor Property");
    expect(initialReadModels.kpiModel.kpis.revenue).toBe(700);
    expect(initialReadModels.executiveSummary.health.label).toBe(
      "Critical",
    );
    expect(JSON.stringify(element.props)).not.toContain(
      "Primary Property",
    );

    // The revoked co-owner loses the Health tile.
    expect(initialReadModels.isOwnerOrCoOwner).toBe(false);

    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("workspace-income:700");
    expect(markup).toContain("property:Actor Property");
    expect(markup).toContain("health:Critical");
    expect(markup).toContain("co-owner:false");
    expect(markup).not.toContain("Primary Property");
  });
});
