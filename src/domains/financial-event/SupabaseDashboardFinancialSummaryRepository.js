// FORGE load-times Slice 3 — dashboard SQL aggregation.
//
// Narrow, dashboard-only read of the forge_dashboard_financial_summary_v1
// RPC. This repository NEVER returns transaction rows: the RPC aggregates
// inside PostgreSQL and the DTO carries a transactionsStatus:'not-loaded'
// marker, so an absent history list can never read as an empty complete
// one. Full history stays available on demand through the dashboard
// diagnostic endpoint, which uses the legacy full-history repository.
//
// The caller is always the authenticated (cookie-bound) Supabase client,
// so the RPC runs SECURITY INVOKER under RLS exactly like the legacy
// repository reads. An RPC failure is thrown, never turned into
// fabricated zero totals.

const SUMMARY_FUNCTION = "forge_dashboard_financial_summary_v1";
const SUMMARY_VERSION = "forge_dashboard_financial_summary_v1";

const KNOWN_SCOPES = new Set(["business", "personal", null, "all"]);

function toFiniteNumber(value, field) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Dashboard financial summary field ${field} must be a finite number.`,
    );
  }

  return number;
}

function toTransactionCount(value, field) {
  const number = toFiniteNumber(value, field);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(
      `Dashboard financial summary field ${field} must be a non-negative integer.`,
    );
  }

  return number;
}

function mapPortfolioTotals(portfolio) {
  if (!portfolio || typeof portfolio !== "object") {
    throw new Error(
      "Dashboard financial summary is missing portfolio totals.",
    );
  }

  return Object.freeze({
    income: toFiniteNumber(portfolio.income, "portfolio.income"),
    expenses: toFiniteNumber(portfolio.expenses, "portfolio.expenses"),
    noi: toFiniteNumber(portfolio.noi, "portfolio.noi"),
    cashFlow: toFiniteNumber(portfolio.cashFlow, "portfolio.cashFlow"),
    transactionCount: toTransactionCount(
      portfolio.transactionCount,
      "portfolio.transactionCount",
    ),
  });
}

function mapPropertyTotals(properties) {
  if (!Array.isArray(properties)) {
    throw new Error(
      "Dashboard financial summary properties must be an array.",
    );
  }

  return Object.freeze(
    properties
      .map((property) => {
        if (
          !property ||
          typeof property !== "object" ||
          typeof property.propertyId !== "string" ||
          !property.propertyId
        ) {
          throw new Error(
            "Dashboard financial summary property is missing propertyId.",
          );
        }

        return Object.freeze({
          propertyId: property.propertyId,
          income: toFiniteNumber(property.income, "property.income"),
          expenses: toFiniteNumber(property.expenses, "property.expenses"),
          noi: toFiniteNumber(property.noi, "property.noi"),
          cashFlow: toFiniteNumber(property.cashFlow, "property.cashFlow"),
          transactionCount: toTransactionCount(
            property.transactionCount,
            "property.transactionCount",
          ),
        });
      })
      // Same deterministic ascending order as
      // FinancialEventAggregationService (localeCompare), regardless of
      // the database collation the RPC ordered by.
      .sort((left, right) =>
        left.propertyId.localeCompare(right.propertyId),
      ),
  );
}

function mapCategoryTotals(categories) {
  if (!Array.isArray(categories)) {
    throw new Error(
      "Dashboard financial summary categories must be an array.",
    );
  }

  return Object.freeze(
    categories
      .map((category) => {
        if (
          !category ||
          typeof category !== "object" ||
          typeof category.category !== "string" ||
          !category.category
        ) {
          throw new Error(
            "Dashboard financial summary category is missing category.",
          );
        }

        return Object.freeze({
          category: category.category,
          income: toFiniteNumber(category.income, "category.income"),
          expenses: toFiniteNumber(category.expenses, "category.expenses"),
          netAmount: toFiniteNumber(category.netAmount, "category.netAmount"),
          transactionCount: toTransactionCount(
            category.transactionCount,
            "category.transactionCount",
          ),
        });
      })
      .sort((left, right) =>
        left.category.localeCompare(right.category),
      ),
  );
}

export class SupabaseDashboardFinancialSummaryRepository {
  constructor({ supabaseClient } = {}) {
    if (supabaseClient !== undefined) {
      if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
        throw new Error(
          "SupabaseDashboardFinancialSummaryRepository requires a Supabase client.",
        );
      }

      this.supabaseClient = supabaseClient;
    } else {
      // Same lazy-import rationale as SupabaseFinancialEventRepository:
      // importing @/lib/supabase at module load eagerly creates the
      // shared browser client (and throws when its env is missing),
      // which poisons every module graph that only ever injects its own
      // server client.
      this.supabaseClient = null;
    }
  }

  async _client() {
    if (!this.supabaseClient) {
      const { supabase } = await import("@/lib/supabase");

      if (!supabase || typeof supabase.rpc !== "function") {
        throw new Error(
          "SupabaseDashboardFinancialSummaryRepository requires a Supabase client.",
        );
      }

      this.supabaseClient = supabase;
    }

    return this.supabaseClient;
  }

  async getSummary({ ownerId, scope = "business" } = {}) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    if (!KNOWN_SCOPES.has(scope)) {
      throw new Error(
        `Unsupported financial workspace scope: ${scope}`,
      );
    }

    const client = await this._client();

    const { data, error } = await client.rpc(SUMMARY_FUNCTION, {
      p_owner_id: ownerId,
      // null means unfiltered (every business_scope) in the RPC, matching
      // the aggregation service's scope=null behavior.
      p_scope: scope === "all" ? null : scope,
    });

    if (error) {
      throw error;
    }

    if (!data || typeof data !== "object") {
      throw new Error(
        "Dashboard financial summary returned no data.",
      );
    }

    if (data.version !== SUMMARY_VERSION) {
      throw new Error(
        `Unsupported dashboard financial summary version: ${data.version}`,
      );
    }

    if (data.status !== "ok") {
      throw new Error(
        "Dashboard financial summary returned a non-ok status.",
      );
    }

    return Object.freeze({
      version: SUMMARY_VERSION,
      ownerId,
      scope: scope === "all" ? null : scope,
      portfolio: mapPortfolioTotals(data.portfolio),
      properties: mapPropertyTotals(data.properties),
      categories: mapCategoryTotals(data.categories),
      transactionsStatus: "not-loaded",
    });
  }
}

Object.freeze(SupabaseDashboardFinancialSummaryRepository);
