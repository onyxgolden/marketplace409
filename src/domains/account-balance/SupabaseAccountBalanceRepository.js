import { supabase as defaultSupabase } from "@/lib/supabase";

import {
  mapAccountBalanceRowToAccountBalance,
} from "./account-balance.mapper";

export class SupabaseAccountBalanceRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient || defaultSupabase;
  }

  async save(balance, context) {
    const saved = await this.saveMany(
      [balance],
      context,
    );

    return saved[0];
  }

  async saveMany(balances, context) {
    if (!Array.isArray(balances)) {
      throw new Error(
        "Account balances must be an array",
      );
    }

    if (balances.length === 0) {
      return Object.freeze([]);
    }

    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabase
      .from("account_balances")
      .upsert(
        balances.map((balance) =>
          this.toRow(balance, ownerId)
        ),
        {
          onConflict:
            "owner_id,financial_account_id,as_of",
        },
      )
      .select("*");

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findLatestByOwnerId(ownerId) {
    this.requireIdentifier(
      ownerId,
      "Account balance owner id is required",
    );

    const { data, error } = await this.supabase
      .from("account_balances")
      .select("*")
      .eq("owner_id", ownerId)
      .order("financial_account_id", {
        ascending: true,
      })
      .order("as_of", {
        ascending: false,
      })
      .order("id", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    const latestByAccount = new Map();

    for (const balance of this.mapRows(data)) {
      if (
        !latestByAccount.has(
          balance.financialAccountId,
        )
      ) {
        latestByAccount.set(
          balance.financialAccountId,
          balance,
        );
      }
    }

    return Object.freeze(
      Array.from(latestByAccount.values()),
    );
  }

  async findByFinancialAccount(
    financialAccountId,
  ) {
    this.requireIdentifier(
      financialAccountId,
      "Financial account id is required",
    );

    const { data, error } = await this.supabase
      .from("account_balances")
      .select("*")
      .eq(
        "financial_account_id",
        financialAccountId,
      )
      .order("as_of", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findLatestByFinancialAccount(
    financialAccountId,
  ) {
    this.requireIdentifier(
      financialAccountId,
      "Financial account id is required",
    );

    const { data, error } = await this.supabase
      .from("account_balances")
      .select("*")
      .eq(
        "financial_account_id",
        financialAccountId,
      )
      .order("as_of", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapAccountBalanceRowToAccountBalance(data),
        )
      : null;
  }

  async findByConnection(connectionId) {
    this.requireIdentifier(
      connectionId,
      "Connection id is required",
    );

    const { data, error } = await this.supabase
      .from("account_balances")
      .select("*")
      .eq("connection_id", connectionId)
      .order("as_of", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  requireOwnerId(context) {
    const ownerId = context?.ownerId;

    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Account balance owner id is required",
      );
    }

    return ownerId;
  }

  requireIdentifier(value, message) {
    if (
      typeof value !== "string" ||
      value.trim() === ""
    ) {
      throw new Error(message);
    }
  }

  toRow(balance, ownerId) {
    if (!balance || typeof balance !== "object") {
      throw new Error(
        "Account balance is required",
      );
    }

    return {
      id: balance.id,
      owner_id: ownerId,
      financial_account_id:
        balance.financialAccountId,
      connection_id: balance.connectionId,
      provider: balance.provider,
      provider_account_id:
        balance.providerAccountId,
      currency_code: balance.currencyCode,
      current_balance_cents:
        balance.currentBalanceCents,
      available_balance_cents:
        balance.availableBalanceCents ?? null,
      as_of: balance.asOf,
      created_at: balance.createdAt,
    };
  }

  mapRows(rows) {
    return Object.freeze(
      (rows || []).map((row) =>
        Object.freeze(
          mapAccountBalanceRowToAccountBalance(
            row,
          ),
        ),
      ),
    );
  }
}

Object.freeze(SupabaseAccountBalanceRepository);
