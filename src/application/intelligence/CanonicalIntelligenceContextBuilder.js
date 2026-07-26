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

  async build({
    ownerId,
    connectionId,
    executionResult = {},
  } = {}) {
    const dashboard =
      await this.financialReadModelApplication.buildDashboard();

    const intelligence =
      await this.financialIntelligenceApplication
        .buildFinancialIntelligence();

    const financial =
      Object.freeze({
        workspace: dashboard.workspace || null,
        dashboard: dashboard.dashboard || null,
        intelligence,
        position: Object.freeze({
          assets:
            dashboard.dashboard?.assets || [],

          liabilities:
            dashboard.dashboard?.liabilities || [],

          balanceSheetLines:
            dashboard.dashboard?.balanceSheetLines || [],

          kpis:
            dashboard.dashboard?.kpis || {},

          metadata:
            dashboard.dashboard?.metadata || {},
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
