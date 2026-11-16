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
    assets: positionProjection.assets || [],
    liabilities: positionProjection.liabilities || [],
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
    decisionOutcomeQueryService = null,
    decisionOutcomeReadModelAdapter = null,
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

    const hasDecisionOutcomeQueryService =
      decisionOutcomeQueryService !== null;
    const hasDecisionOutcomeReadModelAdapter =
      decisionOutcomeReadModelAdapter !== null;

    if (
      hasDecisionOutcomeQueryService !==
      hasDecisionOutcomeReadModelAdapter
    ) {
      throw new Error(
        "FinancialReadModelApplication requires both decision outcome dependencies.",
      );
    }

    if (
      hasDecisionOutcomeQueryService &&
      typeof decisionOutcomeQueryService.findByDecisionId !==
        "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a decision outcome query service.",
      );
    }

    if (
      hasDecisionOutcomeReadModelAdapter &&
      typeof decisionOutcomeReadModelAdapter.buildOutcome !==
        "function"
    ) {
      throw new Error(
        "FinancialReadModelApplication requires a decision outcome read model adapter.",
      );
    }

    if (typeof currentOwnerId !== "function") {
      throw new Error(
        "FinancialReadModelApplication requires a current owner id resolver.",
      );
    }

    // S1 (load-times slice 1): per-request memoization. This instance is
    // built fresh per request — createFinancialApplicationSuite constructs
    // a new one per suite call and the suite is memoized per
    // createAuthenticatedForgeApplication call — so a promise cached here
    // can never leak across requests or owners. The /forge page fires the
    // four dashboard builders plus a direct buildWorkspace concurrently
    // (and the canonical-intelligence builder fires buildDashboard first);
    // all of them share one workspace build, one position build, and one
    // dashboard build per owner+scope instead of each re-scanning the
    // owner's full financial-event history. Promises are cached, not
    // resolved values, so concurrent callers share the in-flight scan.
    // A rejected promise is evicted, never cached: a later call in the
    // same request retries instead of replaying the failure.
    this._requestMemo = {
      workspaces: new Map(),
      dashboards: new Map(),
      positions: new Map(),
    };

    this.financialWorkspaceQueryService =
      financialWorkspaceQueryService;

    // Preserved for composition compatibility until Phase 16.3D.
    this.readModelAdapter = readModelAdapter;

    this.financialPositionQueryService =
      financialPositionQueryService;
    this.financialPositionReadModelAdapter =
      financialPositionReadModelAdapter;
    this.decisionOutcomeQueryService =
      decisionOutcomeQueryService;
    this.decisionOutcomeReadModelAdapter =
      decisionOutcomeReadModelAdapter;
    this.currentOwnerId = currentOwnerId;

    Object.freeze(this);
  }

  async buildDecisionOutcome(decisionId) {
    if (!this.decisionOutcomeQueryService) {
      throw new Error(
        "Decision outcome read model is unavailable.",
      );
    }

    const evaluation =
      await this.decisionOutcomeQueryService.findByDecisionId(
        decisionId,
      );

    if (evaluation === null) {
      return null;
    }

    return this.decisionOutcomeReadModelAdapter.buildOutcome(
      evaluation,
    );
  }

  async resolveOwnerId() {
    const ownerId = await this.currentOwnerId();

    if (!ownerId) {
      throw new Error("Authenticated owner id is required.");
    }

    return ownerId;
  }

  // Defaults every dashboard-facing builder to business-only activity — a caller must explicitly
  // pass scope: "personal" (or "all" to get everything, tagged but unfiltered) to see anything
  // else. Financial FORGE's headline numbers (KPIs, health, NOI) must never silently blend a
  // personal Simplifi import into business totals just because a caller forgot to ask for scope.
  resolveWorkspaceScope(scope) {
    if (scope === undefined) return "business";
    if (scope === "all") return null;
    if (scope === "business" || scope === "personal" || scope === null) return scope;

    throw new Error(`Unsupported financial workspace scope: ${scope}`);
  }

  // S1: share one in-flight promise per key across concurrent callers in
  // this request; never cache a rejection.
  _memoize(map, key, build) {
    const cached = map.get(key);

    if (cached) {
      return cached;
    }

    const promise = build();

    map.set(key, promise);
    promise.catch(() => {
      if (map.get(key) === promise) {
        map.delete(key);
      }
    });

    return promise;
  }

  async buildWorkspace(ownerId = null, { scope } = {}) {
    const resolvedOwnerId =
      ownerId || await this.resolveOwnerId();
    const resolvedScope = this.resolveWorkspaceScope(scope);
    const key = JSON.stringify([
      resolvedOwnerId,
      resolvedScope,
    ]);

    return this._memoize(
      this._requestMemo.workspaces,
      key,
      () =>
        this.financialWorkspaceQueryService.buildWorkspace(
          resolvedOwnerId,
          { scope: resolvedScope },
        ),
    );
  }

  async buildDashboard({ scope } = {}) {
    const ownerId = await this.resolveOwnerId();
    const resolvedScope = this.resolveWorkspaceScope(scope);
    const key = JSON.stringify([
      ownerId,
      resolvedScope,
    ]);

    return this._memoize(
      this._requestMemo.dashboards,
      key,
      () => this._buildDashboard(ownerId, resolvedScope),
    );
  }

  async _buildDashboard(ownerId, resolvedScope) {
    const workspace = await this.buildWorkspace(ownerId, {
      scope: resolvedScope,
    });
    const activityDashboard =
      this.readModelAdapter.buildDashboard(workspace);

    if (!this.financialPositionQueryService) {
      return Object.freeze({
        workspace,
        dashboard: activityDashboard,
      });
    }

    const position = await this._buildPosition(ownerId);

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

  async _buildPosition(ownerId) {
    return this._memoize(
      this._requestMemo.positions,
      ownerId,
      () =>
        this.financialPositionQueryService.buildPosition(
          ownerId,
        ),
    );
  }

  async buildFinancialDashboard({ scope } = {}) {
    const { dashboard } = await this.buildDashboard({ scope });

    return Object.freeze({
      type: "financial-dashboard",
      dashboard,
    });
  }

  async buildBusinessDashboard({ scope } = {}) {
    const { workspace, dashboard } =
      await this.buildDashboard({ scope });

    const reports =
      this.readModelAdapter.buildReports(workspace);

    return Object.freeze({
      type: "business-dashboard",
      reports,
      dashboard,
    });
  }

  async buildInvestorDashboard({ scope } = {}) {
    const { dashboard } = await this.buildDashboard({ scope });

    return Object.freeze({
      type: "investor-dashboard",
      kpis: dashboard.kpis,
      health: dashboard.health,
      metadata: dashboard.metadata,
    });
  }

  async buildKPIModel({ scope } = {}) {
    const { dashboard } = await this.buildDashboard({ scope });

    return Object.freeze({
      type: "kpi-model",
      kpis: dashboard.kpis,
    });
  }

  async buildExecutiveSummary({ scope } = {}) {
    const { dashboard } = await this.buildDashboard({ scope });

    return Object.freeze({
      type: "executive-summary",
      health: dashboard.health,
      kpis: dashboard.kpis,
    });
  }
}

Object.freeze(FinancialReadModelApplication);
