import { FinancialImportServiceImpl } from "../../domains/financial-import/financial-import.service";
import { buildProductionChartOfAccounts } from "../../domains/production";

function importErrorMessage(caughtError) {
  return caughtError instanceof Error
    ? caughtError.message
    : "Unable to import financial CSV.";
}

function propertyLoadErrorMessage(caughtError) {
  return caughtError instanceof Error
    ? caughtError.message
    : "Unable to load financial import data.";
}

async function defaultSupabaseClient() {
  const { supabase } = await import("../../lib/supabase");

  return supabase;
}

async function defaultCurrentOwnerId({ supabaseClient = defaultSupabaseClient } = {}) {
  const client = await supabaseClient();
  const { data, error: authError } = await client.auth.getUser();

  if (authError || !data?.user?.id) {
    return null;
  }

  return data.user.id;
}

async function defaultLoadProperties({ supabaseClient = defaultSupabaseClient } = {}) {
  const client = await supabaseClient();

  const { data, error: propertyError } = await client
    .from("investor_properties")
    .select("*")
    .order("created_at", { ascending: false });

  if (propertyError) {
    throw new Error(propertyError.message);
  }

  return data || [];
}

export class FinancialImportApplication {
  constructor({
    importServiceFactory = ({ ownerId }) =>
      new FinancialImportServiceImpl({ ownerId }),
    chartOfAccountsFactory = buildProductionChartOfAccounts,
    supabaseClient = defaultSupabaseClient,
    currentOwnerId = () => defaultCurrentOwnerId({ supabaseClient }),
    loadProperties = () => defaultLoadProperties({ supabaseClient }),
  } = {}) {
    this.importServiceFactory = importServiceFactory;
    this.chartOfAccountsFactory = chartOfAccountsFactory;
    this.currentOwnerId = currentOwnerId;
    this.loadProperties = loadProperties;

    Object.freeze(this);
  }

  async initialize() {
    try {
      const [ownerId, properties] = await Promise.all([
        this.currentOwnerId(),
        this.loadProperties(),
      ]);

      return Object.freeze({
        ownerId,
        properties: Object.freeze([...(properties || [])]),
        error: "",
      });
    } catch (caughtError) {
      return Object.freeze({
        ownerId: null,
        properties: Object.freeze([]),
        error: propertyLoadErrorMessage(caughtError),
      });
    }
  }

  async importFile({
    file,
    source,
    ownerId = null,
    resolveOwnerId = this.currentOwnerId,
  } = {}) {
    if (!file) {
      return Object.freeze({
        fileName: "",
        result: null,
        error: "",
        ownerId,
        hasFile: false,
      });
    }

    try {
      const csv = await file.text();
      const resolvedOwnerId = ownerId ?? await resolveOwnerId();

      const importService = this.importServiceFactory({
        ownerId: resolvedOwnerId,
      });

      const result = importService.importCsv({
        source,
        csv,
        chartOfAccounts: this.chartOfAccountsFactory(),
      });

      return Object.freeze({
        fileName: file.name,
        result,
        error: "",
        ownerId: resolvedOwnerId,
        hasFile: true,
      });
    } catch (caughtError) {
      return Object.freeze({
        fileName: file.name,
        result: null,
        error: importErrorMessage(caughtError),
        ownerId,
        hasFile: true,
      });
    }
  }
}
