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

export class FinancialReadModelApplication {
  constructor({
    financialWorkspaceQueryService,
    readModelAdapter,
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

    if (typeof currentOwnerId !== "function") {
      throw new Error(
        "FinancialReadModelApplication requires a current owner id resolver.",
      );
    }

    this.financialWorkspaceQueryService =
      financialWorkspaceQueryService;
    this.readModelAdapter = readModelAdapter;
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

  async buildFinancialDashboard() {
    const workspace = await this.buildWorkspace();
    const dashboard = this.readModelAdapter.buildDashboard(workspace);

    return Object.freeze({
      type: "financial-dashboard",
      dashboard,
    });
  }

  async buildBusinessDashboard() {
    const workspace = await this.buildWorkspace();
    const reports = this.readModelAdapter.buildReports(workspace);
    const dashboard = this.readModelAdapter.buildDashboard(workspace);

    return Object.freeze({
      type: "business-dashboard",
      reports,
      dashboard,
    });
  }

  async buildInvestorDashboard() {
    const workspace = await this.buildWorkspace();
    const dashboard = this.readModelAdapter.buildDashboard(workspace);

    return Object.freeze({
      type: "investor-dashboard",
      kpis: dashboard.kpis,
      health: dashboard.health,
      metadata: dashboard.metadata,
    });
  }

  async buildKPIModel() {
    const workspace = await this.buildWorkspace();
    const dashboard = this.readModelAdapter.buildDashboard(workspace);

    return Object.freeze({
      type: "kpi-model",
      kpis: dashboard.kpis,
    });
  }

  async buildExecutiveSummary() {
    const workspace = await this.buildWorkspace();
    const dashboard = this.readModelAdapter.buildDashboard(workspace);

    return Object.freeze({
      type: "executive-summary",
      health: dashboard.health,
      kpis: dashboard.kpis,
    });
  }
}

Object.freeze(FinancialReadModelApplication);
