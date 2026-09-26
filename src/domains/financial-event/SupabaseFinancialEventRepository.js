import { FinancialEventRepository } from "./FinancialEventRepository";

export class SupabaseFinancialEventRepository extends FinancialEventRepository {
  constructor({ supabaseClient } = {}) {
    super();

    if (supabaseClient !== undefined) {
      if (!supabaseClient || typeof supabaseClient.from !== "function") {
        throw new Error(
          "SupabaseFinancialEventRepository requires a Supabase client.",
        );
      }

      this.supabaseClient = supabaseClient;
    } else {
      // Resolved lazily on first use: importing @/lib/supabase at module load eagerly
      // creates the shared browser client (and throws when its env is missing), which
      // poisons every module graph that only ever injects its own server client.
      this.supabaseClient = null;
    }
  }

  async _client() {
    if (!this.supabaseClient) {
      const { supabase } = await import("@/lib/supabase");

      if (!supabase || typeof supabase.from !== "function") {
        throw new Error(
          "SupabaseFinancialEventRepository requires a Supabase client.",
        );
      }

      this.supabaseClient = supabase;
    }

    return this.supabaseClient;
  }

  async saveMany(events) {
    if (!Array.isArray(events)) {
      throw new Error("Financial events must be an array");
    }

    if (events.length === 0) {
      return Object.freeze([]);
    }

    const client = await this._client();

    const { data, error } = await client
      .from("financial_events")
      .upsert(events.map((event) => this.toRow(event)), {
        onConflict: "owner_id,source_system,source_record_id",
        ignoreDuplicates: true,
      })
      .select("*");

    if (error) {
      throw error;
    }

    return Object.freeze(
      (data || []).map((row) => Object.freeze(this.toFinancialEvent(row))),
    );
  }

  async findByOwnerId(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const pageSize = 1000;
    let offset = 0;
    const rows = [];

    while (true) {
      const client = await this._client();

      const { data, error } = await client
        .from("financial_events")
        .select("*")
        .eq("owner_id", ownerId)
        .order("event_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw error;
      }

      rows.push(...(data ?? []));

      if (!data || data.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return Object.freeze(
      rows.map((row) => Object.freeze(this.toFinancialEvent(row))),
    );
  }

  // Personal-budgeting suggestions read this: every expense event for one owner/scope from
  // sinceDate forward. Unlike findByOwnerId, this filters at the query level (business_scope,
  // transaction_kind, is_deleted, event_date) rather than returning everything for the caller to
  // sift through -- the budgeting domain layer only ever needs expense rows in its lookback window.
  async findExpenseEventsSince({ ownerId, businessScope, sinceDate }) {
    return this.#findEventsSinceByKind({ ownerId, businessScope, sinceDate, transactionKind: "expense" });
  }

  // The zero-based budget summary reads this: every income event for one owner/scope from
  // sinceDate forward, so "unassigned" can be computed as income minus total planned.
  async findIncomeEventsSince({ ownerId, businessScope, sinceDate }) {
    return this.#findEventsSinceByKind({ ownerId, businessScope, sinceDate, transactionKind: "income" });
  }

  async #findEventsSinceByKind({ ownerId, businessScope, sinceDate, transactionKind }) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }
    if (!businessScope) {
      throw new Error("Business scope is required");
    }
    if (!sinceDate) {
      throw new Error("Since date is required");
    }

    const pageSize = 1000;
    let offset = 0;
    const rows = [];

    while (true) {
      const client = await this._client();

      const { data, error } = await client
        .from("financial_events")
        .select("event_date, amount, normalized_category, description")
        .eq("owner_id", ownerId)
        .eq("business_scope", businessScope)
        .eq("transaction_kind", transactionKind)
        .eq("is_deleted", false)
        .gte("event_date", sinceDate)
        .order("event_date", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw error;
      }

      rows.push(...(data ?? []));

      if (!data || data.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          event_date: row.event_date,
          amount: Number(row.amount),
          normalized_category: row.normalized_category,
          description: row.description,
        }),
      ),
    );
  }

  async count(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const client = await this._client();

    const { count, error } = await client
      .from("financial_events")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("owner_id", ownerId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  toRow(event) {
    if (!event || typeof event !== "object") {
      throw new Error("Financial event is required");
    }

    if (!event.owner_id) {
      throw new Error("Financial event owner_id is required");
    }

    const row = {
      owner_id: event.owner_id,
      organization_id: event.organization_id ?? null,
      property_id: event.property_id ?? null,
      financial_account_id: event.financial_account_id ?? null,
      // Deliberately OMITTED (not sent as an explicit null) when absent -- financial_events.
      // business_scope is `not null default 'business'` at the database level
      // (20260824030000_add_financial_events_business_scope.sql). An explicit null in the insert
      // payload overrides that default and is rejected by the not-null constraint; omitting the
      // key entirely lets Postgres apply its own default, which is exactly what every caller that
      // has never set business_scope (e.g. the canonical connection-import pipeline -- Plaid and
      // Stripe Financial Connections transactions never populate it) needs. Never duplicate the
      // 'business' default here in application code -- the database is the single source of
      // truth for it.
      ...(event.business_scope ? { business_scope: event.business_scope } : {}),
      event_date: event.event_date,
      description: event.description,
      amount: event.amount,
      transaction_kind: event.transaction_kind,
      normalized_category: event.normalized_category,
      tax_deductible: event.tax_deductible,
      affects_noi: event.affects_noi,
      capitalized: event.capitalized,
      source_system: event.source_system,
      source_record_id: event.source_record_id ?? null,
      metadata: event.metadata ?? {},
      status: event.status ?? "active",
      is_deleted: event.is_deleted ?? false,
      deleted_at: event.deleted_at ?? null,
      created_by: event.created_by ?? null,
      updated_by: event.updated_by ?? null,
      created_at: event.created_at,
      updated_at: event.updated_at,
    };

    if (event.id) {
      row.id = event.id;
    }

    return row;
  }

  toFinancialEvent(row) {
    return {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by ?? null,
      updated_by: row.updated_by ?? null,
      owner_id: row.owner_id,
      organization_id: row.organization_id ?? null,
      status: row.status,
      is_deleted: row.is_deleted,
      deleted_at: row.deleted_at ?? null,
      property_id: row.property_id ?? null,
      financial_account_id: row.financial_account_id ?? null,
      business_scope: row.business_scope ?? null,
      event_date: row.event_date,
      description: row.description,
      amount: Number(row.amount),
      transaction_kind: row.transaction_kind,
      normalized_category: row.normalized_category,
      tax_deductible: row.tax_deductible,
      affects_noi: row.affects_noi,
      capitalized: row.capitalized,
      source_system: row.source_system,
      source_record_id: row.source_record_id ?? null,
      metadata: row.metadata ?? null,
    };
  }
}

Object.freeze(SupabaseFinancialEventRepository);
