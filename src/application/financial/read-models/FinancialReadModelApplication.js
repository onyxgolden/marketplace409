async function defaultSupabaseClient() {
  const { supabase } = await import("../../../lib/supabase");

  return supabase;
}

async function defaultCurrentOwnerId({
  supabaseClient = defaultSupabaseClient,
} = {}) {
  const client = await supabaseClient();
  const { data, error: authError } = await client.auth.getUser();

  if (authError || !data?.user?.id) {
    return null;
  }

  return data.user.id;
}

function freezeObject(value) {
  return Object.freeze({
    ...value,
  });
}

function mergeDashboardProjections({
  activityDashboard,
  positionProjection,
}) {
  if (!positionProjection) {
    return activityDashboard;
  }

  return Object.freeze({
    kpis: freezeObject({
      ...activityDashboard.kpis,
      ...positionProjection.kpis,
    }),
    health: activityDashboard.health,
    balanceSheetLines: positionProjection.balanceSheetLines,
    metadata: freezeObject({
      ...activityDashboard.metadata,
      ...positionProjection.metadata,
      provider: "financial-events+financial-position",
      snapshotStatus: "repository-backed",
      phase: "16.3",
    }),
  });
}

export class FinancialReadModelApplication {
  constructor({
    financialWorkspaceQueryService,
    readModelAdapter,
    financialPositionQueryService = null,
    financialPositionReadModelAdapter = null,
    supabaseClient = defaultSupabaseClient,
    currentOwnerId = () =>
      defaultCurrentOwnerId({ supabaseClient }),
  } = {}) {
    if (
      !financialWorkspaceQueryService ||
      typeof financialWorkspaceQueryService.buildWorkspace !== "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a financial workspace query service.",
      );
    }

    if (
      !readModelAdapter ||
      typeof readModelAdapter.buildDashboard !== "function" ||
      typeof readModelAdapter.buildReports !== "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a financial workspace read model adapter.",
      );
    }

    const hasPositionQueryService =
      financialPositionQueryService !== null;
    const hasPositionAdapter =
      financialPositionReadModelAdapter !== null;

    if (hasPositionQueryService !== hasPositionAdapter) {
      throw new Error(
        "FinancialReadModelApplication requires both financial position dependencies.",
      );
    }

    if (
      hasPositionQueryService &&
      typeof financialPositionQueryService.buildPosition !== "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a financial position query service.",
      );
    }

    if (
      hasPositionAdapter &&
      typeof financialPositionReadModelAdapter.buildPosition !== "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a financial position read model adapter.",
      );
    }

    if (typeof currentOwnerId !== "function") {
      throw new Error(
        "FinancialReadModelApplication requires a current owner id resolver.",
      );
    }

    this.financialWorkspaceQueryService =
      financialWorkspaceQueryService;

    // Preserved for composition compatibility until Phase 16.3D.
    this.readModelAdapter = readModelAdapter;

    this.financialPositionQueryService =
      financialPositionQueryService;
    this.financialPositionReadModelAdapter =
      financialPositionReadModelAdapter;
    this.currentOwnerId = currentOwnerId;

    Object.freeze(this);
  }

  async buildWorkspace() {
    const ownerId = await this.currentOwnerId();

    if (!ownerId) {
      throw new Error("Authenticated owner id is required.");
    }

    return this.financialWorkspaceQueryService.buildWorkspace(ownerId);
  }

  async buildDashboard() {
    const workspace = await this.buildWorkspace();
    const activityDashboard =
      this.readModelAdapter.buildDashboard(workspace);

    if (!this.financialPositionQueryService) {
      return Object.freeze({
        workspace,
        dashboard: activityDashboard,
      });
    }

    const position =
      await this.financialPositionQueryService.buildPosition();

    const positionProjection =
      this.financialPositionReadModelAdapter.buildPosition(position);

    return Object.freeze({
      workspace,
      dashboard: mergeDashboardProjections({
        activityDashboard,
        positionProjection,
      }),
    });
  }

  async buildFinancialDashboard() {
    const { dashboard } = await this.buildDashboard();

    return Object.freeze({
      type: "financial-dashboard",
      dashboard,
    });
  }

  async buildBusinessDashboard() {
    const { workspace, dashboard } =
      await this.buildDashboard();

    const reports =
      this.readModelAdapter.buildReports(workspace);

    return Object.freeze({
      type: "business-dashboard",
      reports,
      dashboard,
    });
  }

  async buildInvestorDashboard() {
    const { dashboard } = await this.buildDashboard();

    return Object.freeze({
      type: "investor-dashboard",
      kpis: dashboard.kpis,
      health: dashboard.health,
      metadata: dashboard.metadata,
    });
  }

  async buildKPIModel() {
    const { dashboard } = await this.buildDashboard();

    return Object.freeze({
      type: "kpi-model",
      kpis: dashboard.kpis,
    });
  }

  async buildExecutiveSummary() {
    const { dashboard } = await this.buildDashboard();

    return Object.freeze({
      type: "executive-summary",
      health: dashboard.health,
      kpis: dashboard.kpis,
    });
  }
}

Object.freeze(FinancialReadModelApplication);
