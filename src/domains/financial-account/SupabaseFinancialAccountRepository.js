import { supabase as defaultSupabase } from "@/lib/supabase";

import {
  mapFinancialAccountRowToFinancialAccount,
} from "./financial-account.mapper";

export class SupabaseFinancialAccountRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient || defaultSupabase;
  }

  async save(account, context) {
    const saved = await this.saveMany([account], context);
    return saved[0];
  }

  async saveMany(accounts, context) {
    if (!Array.isArray(accounts)) {
      throw new Error("Financial accounts must be an array");
    }

    if (accounts.length === 0) {
      return Object.freeze([]);
    }

    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabase
      .from("financial_accounts")
      .upsert(
        accounts.map((account) =>
          this.toRow(account, ownerId)
        ),
        {
          onConflict:
            "owner_id,provider,provider_account_id",
        },
      )
      .select("*");

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findById(id) {
    if (!id) {
      throw new Error("Financial account id is required");
    }

    const { data, error } = await this.supabase
      .from("financial_accounts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapFinancialAccountRowToFinancialAccount(data),
        )
      : null;
  }

  async findByOwnerId(ownerId) {
    this.requireIdentifier(
      ownerId,
      "Financial account owner id is required",
    );

    const { data, error } = await this.supabase
      .from("financial_accounts")
      .select("*")
      .eq("owner_id", ownerId)
      .order("name", {
        ascending: true,
      })
      .order("id", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findByConnection(connectionId) {
    if (!connectionId) {
      throw new Error("Connection id is required");
    }

    const { data, error } = await this.supabase
      .from("financial_accounts")
      .select("*")
      .eq("connection_id", connectionId)
      .order("name", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findByProviderAccountId(
    provider,
    providerAccountId,
  ) {
    if (!provider) {
      throw new Error("Provider is required");
    }

    if (!providerAccountId) {
      throw new Error("Provider account id is required");
    }

    const { data, error } = await this.supabase
      .from("financial_accounts")
      .select("*")
      .eq("provider", provider)
      .eq("provider_account_id", providerAccountId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapFinancialAccountRowToFinancialAccount(data),
        )
      : null;
  }

  requireIdentifier(value, message) {
    if (
      typeof value !== "string" ||
      value.trim() === ""
    ) {
      throw new Error(message);
    }
  }

  mapRows(rows) {
    return Object.freeze(
      (rows || []).map((row) =>
        Object.freeze(
          mapFinancialAccountRowToFinancialAccount(row),
        ),
      ),
    );
  }

  requireOwnerId(context) {
    const ownerId = context?.ownerId;

    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Financial account owner id is required",
      );
    }

    return ownerId;
  }

  toRow(account, ownerId) {
    if (!account || typeof account !== "object") {
      throw new Error("Financial account is required");
    }

    return {
      id: account.id,
      owner_id: ownerId,
      connection_id: account.connectionId,
      provider: account.provider,
      provider_account_id: account.providerAccountId,
      institution_id: account.institutionId,
      name: account.name,
      official_name: account.officialName ?? null,
      mask: account.mask ?? null,
      type: account.type,
      subtype: account.subtype ?? null,
      currency_code: account.currencyCode,
      active: account.active,
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    };
  }
}

Object.freeze(SupabaseFinancialAccountRepository);
