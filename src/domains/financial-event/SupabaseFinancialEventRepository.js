import { supabase } from "@/lib/supabase";

import { FinancialEventRepository } from "./FinancialEventRepository";

export class SupabaseFinancialEventRepository extends FinancialEventRepository {
  constructor({
    supabaseClient = supabase,
  } = {}) {
    super();

    if (
      !supabaseClient ||
      typeof supabaseClient.from !== "function"
    ) {
      throw new Error(
        "SupabaseFinancialEventRepository requires a Supabase client.",
      );
    }

    this.supabaseClient = supabaseClient;
  }

  async saveMany(events) {
    if (!Array.isArray(events)) {
      throw new Error("Financial events must be an array");
    }

    if (events.length === 0) {
      return Object.freeze([]);
    }

    const { data, error } = await this.supabaseClient
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
      const { data, error } = await this.supabaseClient
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

  async count(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const { count, error } = await this.supabaseClient
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
      business_scope: event.business_scope ?? null,
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
