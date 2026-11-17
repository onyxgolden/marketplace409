// FORGE load-times Slice 3 — diagnostic history, server-side pagination.
//
// Narrow, diagnostic-only read of the
// forge_dashboard_financial_transactions_v1 RPC. One RPC call serves one
// page of the owner's eligible transaction history in stable
// event_date,id order, with the exact total count -- the route no longer
// rebuilds the owner's entire history (twelve sequential 1,000-row
// legacy fetches + a full JS re-aggregation) on every page request,
// which exceeded the Vercel Hobby function time budget in production.
//
// The RPC reuses the summary RPC's eligible-set definition verbatim, so
// the rows this repository returns are the same list the legacy path
// served: same filters, same account-group cutover, same record shape
// (abs(amount), unassigned/uncategorized defaults). An RPC failure is
// thrown, never turned into a fabricated empty history. A page past the
// end is a 400-style error (status on the thrown Error), never a silent
// empty page -- the route maps it to HTTP 400, exactly as the legacy
// buildDiagnosticPage path did.
//
// The caller is always the authenticated (cookie-bound) Supabase client,
// so the RPC runs SECURITY INVOKER under RLS exactly like the legacy
// repository reads.

const TRANSACTIONS_FUNCTION = "forge_dashboard_financial_transactions_v1";
const TRANSACTIONS_VERSION = "forge_dashboard_financial_transactions_v1";

const KNOWN_SCOPES = new Set(["business", "personal", null, "all"]);
const KNOWN_KINDS = new Set([
  "income",
  "expense",
  "asset_purchase",
  "transfer",
]);
const PAGE_SIZE_MAX = 1000;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function toFiniteNumber(value, field) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `Dashboard financial transaction field ${field} must be a finite number.`,
    );
  }

  return number;
}

function toNonNegativeInteger(value, field) {
  const number = toFiniteNumber(value, field);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(
      `Dashboard financial transaction field ${field} must be a non-negative integer.`,
    );
  }

  return number;
}

function toRequiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Dashboard financial transaction field ${field} must be a non-empty string.`,
    );
  }

  return value;
}

function toNullableString(value, field) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(
      `Dashboard financial transaction field ${field} must be a string or null.`,
    );
  }

  return value;
}

function toBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new Error(
      `Dashboard financial transaction field ${field} must be a boolean.`,
    );
  }

  return value;
}

function mapTransaction(row) {
  if (!row || typeof row !== "object") {
    throw new Error("Dashboard financial transaction must be an object.");
  }

  if (!KNOWN_KINDS.has(row.transactionKind)) {
    throw new Error(
      `Unsupported financial event transaction kind: ${row.transactionKind}`,
    );
  }

  return Object.freeze({
    id: toRequiredString(row.id, "id"),
    propertyId: toRequiredString(row.propertyId, "propertyId"),
    eventDate: toRequiredString(row.eventDate, "eventDate"),
    description: toNullableString(row.description, "description") ?? "",
    amount: toFiniteNumber(row.amount, "amount"),
    transactionKind: row.transactionKind,
    category: toRequiredString(row.category, "category"),
    affectsNOI: toBoolean(row.affectsNOI, "affectsNOI"),
    capitalized: toBoolean(row.capitalized, "capitalized"),
    sourceSystem: toNullableString(row.sourceSystem, "sourceSystem"),
    sourceRecordId: toNullableString(row.sourceRecordId, "sourceRecordId"),
    businessScope: toNullableString(row.businessScope, "businessScope"),
    financialAccountId: toNullableString(
      row.financialAccountId,
      "financialAccountId",
    ),
  });
}

export class SupabaseDashboardFinancialTransactionsRepository {
  constructor({ supabaseClient } = {}) {
    if (supabaseClient !== undefined) {
      if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
        throw new Error(
          "SupabaseDashboardFinancialTransactionsRepository requires a Supabase client.",
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
          "SupabaseDashboardFinancialTransactionsRepository requires a Supabase client.",
        );
      }

      this.supabaseClient = supabase;
    }

    return this.supabaseClient;
  }

  async getPage({ ownerId, scope = "business", page = 1, pageSize = 1000 } = {}) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    if (!KNOWN_SCOPES.has(scope)) {
      throw new Error(
        `Unsupported financial workspace scope: ${scope}`,
      );
    }

    if (!Number.isInteger(page) || page < 1) {
      throw badRequest("Diagnostic page must be a positive integer.");
    }

    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > PAGE_SIZE_MAX
    ) {
      throw badRequest(
        `Diagnostic pageSize must be an integer between 1 and ${PAGE_SIZE_MAX}.`,
      );
    }

    const client = await this._client();

    const { data, error } = await client.rpc(TRANSACTIONS_FUNCTION, {
      p_owner_id: ownerId,
      // null means unfiltered (every business_scope) in the RPC, matching
      // the aggregation service's scope=null behavior.
      p_scope: scope === "all" ? null : scope,
      p_page: page,
      p_page_size: pageSize,
    });

    if (error) {
      throw error;
    }

    if (!data || typeof data !== "object") {
      throw new Error(
        "Dashboard financial transactions returned no data.",
      );
    }

    if (data.version !== TRANSACTIONS_VERSION) {
      throw new Error(
        `Unsupported dashboard financial transactions version: ${data.version}`,
      );
    }

    if (data.status !== "ok") {
      throw new Error(
        "Dashboard financial transactions returned a non-ok status.",
      );
    }

    if (data.transactionsStatus !== "loaded") {
      throw new Error(
        "Dashboard financial transactions returned a non-loaded status.",
      );
    }

    if (!Array.isArray(data.transactions)) {
      throw new Error(
        "Dashboard financial transactions must be an array.",
      );
    }

    const totalCount = toNonNegativeInteger(
      data.totalCount,
      "totalCount",
    );
    const totalPages = toNonNegativeInteger(
      data.totalPages,
      "totalPages",
    );

    if (totalPages < 1) {
      throw new Error(
        "Dashboard financial transactions totalPages must be at least 1.",
      );
    }

    if (typeof data.complete !== "boolean") {
      throw new Error(
        "Dashboard financial transactions complete must be a boolean.",
      );
    }

    // A page past the end is a client error, never a silent empty page.
    if (page > totalPages) {
      throw badRequest(
        `Diagnostic page ${page} does not exist (only ${totalPages} page(s)).`,
      );
    }

    return Object.freeze({
      version: TRANSACTIONS_VERSION,
      ownerId,
      scope: scope === "all" ? null : scope,
      page,
      pageSize,
      totalCount,
      totalPages,
      complete: data.complete,
      transactions: Object.freeze(data.transactions.map(mapTransaction)),
      transactionsStatus: "loaded",
    });
  }
}

Object.freeze(SupabaseDashboardFinancialTransactionsRepository);
