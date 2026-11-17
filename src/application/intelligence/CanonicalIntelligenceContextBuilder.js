import { CanonicalIntelligenceContext } from "./CanonicalIntelligenceContext.js";

export class CanonicalIntelligenceContextBuilder {
  constructor({
    financialReadModelApplication,
    financialIntelligenceApplication,
    connectionOperationsApplication,
  } = {}) {
    if (!financialReadModelApplication) {
      throw new Error(
        "CanonicalIntelligenceContextBuilder requires a financial read model application.",
      );
    }

    if (!financialIntelligenceApplication) {
      throw new Error(
        "CanonicalIntelligenceContextBuilder requires a financial intelligence application.",
      );
    }

    if (!connectionOperationsApplication) {
      throw new Error(
        "CanonicalIntelligenceContextBuilder requires a connection operations application.",
      );
    }

    this.financialReadModelApplication =
      financialReadModelApplication;

    this.financialIntelligenceApplication =
      financialIntelligenceApplication;

    this.connectionOperationsApplication =
      connectionOperationsApplication;

    Object.freeze(this);
  }

  // Slice 3 (load-times): the /forge dashboard passes its already-built
  // summary dashboard in ({ workspace, dashboard }), so this builder
  // never calls financialReadModelApplication.buildDashboard() -- the
  // legacy full-history path -- on the dashboard route. The same summary
  // dashboard is handed to buildFinancialIntelligence so its KPI/health
  // inputs come from it too. Callers without a dashboard get today's
  // behavior, unchanged.
  async build({
    ownerId,
    connectionId,
    executionResult = {},
    dashboard = null,
  } = {}) {
    const dashboardResult =
      dashboard ??
      (await this.financialReadModelApplication.buildDashboard());

    const intelligence =
      await this.financialIntelligenceApplication
        .buildFinancialIntelligence({ dashboard: dashboardResult });

    const financial =
      Object.freeze({
        workspace: dashboardResult.workspace || null,
        dashboard: dashboardResult.dashboard || null,
        intelligence,
        position: Object.freeze({
          assets:
            dashboardResult.dashboard?.assets || [],

          liabilities:
            dashboardResult.dashboard?.liabilities || [],

          balanceSheetLines:
            dashboardResult.dashboard?.balanceSheetLines || [],

          kpis:
            dashboardResult.dashboard?.kpis || {},

          metadata:
            dashboardResult.dashboard?.metadata || {},
        }),
        reports: null,
      });

    const connections =
      Object.freeze({
        execution:
          this.connectionOperationsApplication
            .buildExecutionIntelligence(
              executionResult,
            ),

        history:
          await this.connectionOperationsApplication
            .getExecutionHistoryIntelligence({
              ownerId,
              connectionId,
            }),
      });

    return new CanonicalIntelligenceContext({
      financial,
      connections,
      provenance: {
        repositoryBacked: true,
        aiGenerated: false,
        sources: [
          "financial-read-models",
          "connection-operations-intelligence",
        ],
      },
    });
  }
}

Object.freeze(CanonicalIntelligenceContextBuilder);
