async function defaultSupabaseClient() {
  const { supabase } = await import("../../lib/supabase");
  return supabase;
}

async function defaultCurrentOwnerId({
  supabaseClient = defaultSupabaseClient,
} = {}) {
  const client = await supabaseClient();

  const {
    data,
    error: authError,
  } = await client.auth.getUser();

  if (authError || !data?.user?.id) {
    return null;
  }

  return data.user.id;
}

export class ConnectionReadModelApplication {
  constructor({
    connectionSummaryQueryService,
    readModelAdapter,
    supabaseClient = defaultSupabaseClient,
    currentOwnerId = () =>
      defaultCurrentOwnerId({
        supabaseClient,
      }),
  } = {}) {
    if (
      !connectionSummaryQueryService ||
      typeof connectionSummaryQueryService.getConnectionCollection !==
        "function"
    ) {
      throw new Error(
        "ConnectionReadModelApplication requires a connection summary query service.",
      );
    }

    if (
      !readModelAdapter ||
      typeof readModelAdapter.buildDashboard !== "function" ||
      typeof readModelAdapter.buildReports !== "function"
    ) {
      throw new Error(
        "ConnectionReadModelApplication requires a connection read model adapter.",
      );
    }

    if (typeof currentOwnerId !== "function") {
      throw new Error(
        "ConnectionReadModelApplication requires a current owner id resolver.",
      );
    }

    this.connectionSummaryQueryService =
      connectionSummaryQueryService;

    this.readModelAdapter =
      readModelAdapter;

    this.currentOwnerId =
      currentOwnerId;

    Object.freeze(this);
  }

  async buildConnectionCollection() {
    const ownerId =
      await this.currentOwnerId();

    if (!ownerId) {
      throw new Error(
        "Authenticated owner id is required.",
      );
    }

    return this.connectionSummaryQueryService.getConnectionCollection(
      ownerId,
    );
  }

  async buildDashboard() {
    const collection =
      await this.buildConnectionCollection();

    return Object.freeze({
      collection,
      dashboard:
        this.readModelAdapter.buildDashboard(
          collection,
        ),
    });
  }

  async buildConnectionDashboard() {
    const { dashboard } =
      await this.buildDashboard();

    return Object.freeze({
      type: "connection-dashboard",
      dashboard,
    });
  }

  async buildConnectionReports() {
    const { collection, dashboard } =
      await this.buildDashboard();

    return Object.freeze({
      type: "connection-reports",
      reports:
        this.readModelAdapter.buildReports(
          collection,
        ),
      dashboard,
    });
  }
}

Object.freeze(ConnectionReadModelApplication);
