const DEFAULT_METADATA = Object.freeze({});

function readModelFailureMessage(payload, fallback) {
  return payload?.error || fallback;
}

export class ForgeConnectionDashboardApplication {
  static buildLoadingModel() {
    return {
      dashboard: null,
      reports: null,
      loadState: "loading",
      error: null,
      summary: {},
      connections: [],
      metadata: DEFAULT_METADATA,
      statusItems: this.buildStatusItems({
        loadState: "loading",
        metadata: DEFAULT_METADATA,
      }),
      activities: this.buildActivities({
        metadata: DEFAULT_METADATA,
      }),
    };
  }

  static buildReadyModel({
    dashboard,
    reports,
  }) {
    const normalizedDashboard =
      dashboard || null;

    const normalizedReports =
      reports || null;

    const metadata =
      normalizedDashboard?.metadata ||
      DEFAULT_METADATA;

    return {
      dashboard: normalizedDashboard,
      reports: normalizedReports,
      loadState: "ready",
      error: null,
      summary:
        normalizedDashboard?.summary ||
        {},
      connections:
        normalizedDashboard?.connections ||
        normalizedReports?.connections ||
        [],
      metadata,
      statusItems: this.buildStatusItems({
        loadState: "ready",
        metadata,
      }),
      activities: this.buildActivities({
        metadata,
      }),
    };
  }

  static buildErrorModel(error) {
    const message =
      error instanceof Error
        ? error.message
        : "Connection dashboard failed to load.";

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

  static async load({
    fetcher = fetch,
  } = {}) {
    try {
      const payload =
        await this.fetchJson({
          fetcher,
          url:
            "/api/connection/operations",
          fallbackMessage:
            "Connection operations failed.",
        });

      return this.buildReadyModel({
        dashboard:
          payload.data?.dashboard?.dashboard ||
          null,
        reports: null,
      });
    } catch (error) {
      return this.buildErrorModel(error);
    }
  }

  static async fetchJson({
    fetcher,
    url,
    fallbackMessage,
  }) {
    const response =
      await fetcher(url);

    const payload =
      await response.json();

    if (!payload.success) {
      throw new Error(
        readModelFailureMessage(
          payload,
          fallbackMessage,
        ),
      );
    }

    return payload;
  }

  static buildStatusItems({
    loadState,
    metadata,
  }) {
    return [
      {
        label: "Connection Platform",
        detail:
          "Repository-backed connection read models are active.",
        value:
          loadState === "ready"
            ? "online"
            : loadState,
      },
      {
        label: "Data Provider",
        detail:
          "Connection data is supplied through the platform provider boundary.",
        value:
          metadata.provider ||
          "pending",
      },
      {
        label: "Snapshot Status",
        detail:
          "Connection state is projected from persistent repository data.",
        value:
          metadata.snapshotStatus ||
          "pending",
      },
    ];
  }

  static buildActivities({
    metadata,
  }) {
    return [
      {
        id: "connection-dashboard-built",
        label:
          "Connection dashboard generated",
        detail:
          "Connection health, readiness, and institution summaries are supplied by the connection platform.",
        type: "domain",
        timestamp:
          "Current session",
      },
      {
        id: "connection-read-model-active",
        label:
          "Repository-backed read model active",
        detail:
          "The dashboard reads authenticated connection data through the connection API boundary.",
        type: "application",
        timestamp:
          `Phase ${metadata.phase || "20D.1"}`,
      },
      {
        id: "connection-provider-active",
        label:
          "Provider abstraction active",
        detail:
          "Connection persistence remains isolated behind repository and provider abstractions.",
        type: "provider",
        timestamp:
          metadata.provider ||
          "Pending",
      },
      {
        id: "manual-sync-planned",
        label:
          "Manual synchronization controls planned",
        detail:
          "Interactive synchronization and repair actions remain sequenced after dashboard presentation.",
        type: "roadmap",
        timestamp:
          "Planned",
      },
    ];
  }
}

Object.freeze(
  ForgeConnectionDashboardApplication,
);
