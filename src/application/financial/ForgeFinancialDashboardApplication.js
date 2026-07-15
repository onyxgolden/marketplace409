const DEFAULT_HEALTH = Object.freeze({
  label: "Loading",
  detail: "Financial dashboard data is loading.",
});

const DEFAULT_METADATA = Object.freeze({});

function snapshotFailureMessage(payload, fallback) {
  return payload?.error || fallback;
}

export class ForgeFinancialDashboardApplication {
  static buildLoadingModel() {
    return {
      dashboard: null,
      operationsPlan: null,
      loadState: "loading",
      error: null,
      kpis: {},
      health: DEFAULT_HEALTH,
      metadata: DEFAULT_METADATA,
      balanceSheetLines: [],
      portfolio: null,
      properties: [],
      categories: [],
      transactions: [],
      statusItems: this.buildStatusItems({
        loadState: "loading",
        metadata: DEFAULT_METADATA,
      }),
      activities: this.buildActivities({ metadata: DEFAULT_METADATA }),
    };
  }

  static buildReadyModel({
    dashboard,
    reports,
    operationsPlan,
  }) {
    const normalizedDashboard = dashboard || null;
    const normalizedReports = reports || null;
    const metadata =
      normalizedDashboard?.metadata ||
      DEFAULT_METADATA;

    return {
      dashboard: normalizedDashboard,
      operationsPlan: operationsPlan || null,
      loadState: "ready",
      error: null,
      kpis: normalizedDashboard?.kpis || {},
      health: normalizedDashboard?.health || DEFAULT_HEALTH,
      metadata,
      balanceSheetLines:
        normalizedDashboard?.balanceSheetLines ||
        [],
      portfolio:
        normalizedReports?.portfolio ||
        null,
      properties:
        normalizedReports?.properties ||
        [],
      categories:
        normalizedReports?.categories ||
        [],
      transactions:
        normalizedReports?.transactions ||
        [],
      statusItems: this.buildStatusItems({
        loadState: "ready",
        metadata,
      }),
      activities: this.buildActivities({ metadata }),
    };
  }

  static buildErrorModel(error) {
    const message =
      error instanceof Error
        ? error.message
        : "Financial dashboard failed to load.";

    return {
      ...this.buildLoadingModel(),
      loadState: "error",
      error: message,
      statusItems: this.buildStatusItems({
        loadState: "error",
        metadata: DEFAULT_METADATA,
      }),
    };
  }

  static async load({ fetcher = fetch } = {}) {
    try {
      const readModelPayload = await this.fetchJson({
        fetcher,
        url:
          "/api/financial/read-models?financial=true&business=true",
        fallbackMessage: "Financial read model failed.",
      });

      const operationsPayload = await this.fetchJson({
        fetcher,
        url: "/api/financial/operations",
        fallbackMessage: "Financial operations failed.",
      });

      return this.buildReadyModel({
        dashboard:
          readModelPayload.data?.financial?.dashboard ||
          null,
        reports:
          readModelPayload.data?.business?.reports ||
          null,
        operationsPlan:
          operationsPayload.data ||
          null,
      });
    } catch (error) {
      return this.buildErrorModel(error);
    }
  }

  static async fetchJson({ fetcher, url, fallbackMessage }) {
    const response = await fetcher(url);
    const payload = await response.json();

    if (!payload.success) {
      throw new Error(snapshotFailureMessage(payload, fallbackMessage));
    }

    return payload;
  }

  static buildStatusItems({ loadState, metadata }) {
    return [
      {
        label: "Financial Workspace",
        detail: "Repository-backed financial workspace read model is active.",
        value: loadState === "ready" ? "online" : loadState,
      },
      {
        label: "Data Provider",
        detail: "Provider abstraction is active for Phase 7.3.",
        value: metadata.provider || "pending",
      },
      {
        label: "Snapshot Status",
        detail: "Live persistence and sync history are deferred.",
        value: metadata.snapshotStatus || "pending",
      },
    ];
  }

  static buildActivities({ metadata }) {
    return [
      {
        id: "dashboard-built",
        label: "Dashboard DTO generated",
        detail:
          "KPIs, health status, and statement lines are supplied by the domain service.",
        type: "domain",
        timestamp: "Current session",
      },
      {
        id: "provider-active",
        label: "Provider abstraction active",
        detail: "Dashboard is reading through the financial API boundary.",
        type: "provider",
        timestamp: `Phase ${metadata.phase || "7.3"}`,
      },
      {
        id: "operations-api",
        label: "Operations plan connected",
        detail:
          "Financial operations guidance is supplied through the operations API.",
        type: "application",
        timestamp: "Phase 13.2",
      },
      {
        id: "imports-deferred",
        label: "External imports deferred",
        detail:
          "Rental, Plaid, brokerage, Stripe, and valuation feeds remain sequenced after dashboard stabilization.",
        type: "roadmap",
        timestamp: "Planned",
      },
    ];
  }
}

Object.freeze(ForgeFinancialDashboardApplication);

