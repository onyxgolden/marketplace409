import { supabase as defaultSupabase } from "@/lib/supabase";

// Thin wrapper around the two atomicity-critical SQL functions
// (claim_financial_account_refresh_work / commit_financial_account_refresh_work) plus the plain,
// single-row status transitions (importing/failed) that need no cross-row invariant beyond what
// a normal UPDATE's WHERE clause already gives. See the migration's own header comment for the
// full design rationale -- this repository intentionally contains no ordering/currency logic of
// its own; callers (the Stripe adapter's refresh coordinator) are responsible for having already
// confirmed, via a live read-only provider retrieve, that any refreshId passed to claim() is
// genuinely current.
export class SupabaseFinancialAccountRefreshRepository {
  constructor(options = {}) {
    this.supabase = options.supabaseClient || defaultSupabase;
  }

  async getWatermark({ financialAccountId, feature }) {
    const { data, error } = await this.supabase
      .from("financial_account_refresh_watermarks")
      .select("*")
      .eq("financial_account_id", financialAccountId)
      .eq("feature", feature)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return Object.freeze({
      financialAccountId: data.financial_account_id,
      feature: data.feature,
      ownerId: data.owner_id,
      committedRefreshId: data.committed_refresh_id,
      committedRefreshLastAttemptedAt: data.committed_refresh_last_attempted_at === null ? null : Number(data.committed_refresh_last_attempted_at),
      committedAt: data.committed_at,
    });
  }

  // Bootstraps the watermark from the legacy vaulted transaction cursor -- ONLY when no watermark
  // row exists yet for this account+feature. Never overwrites an existing watermark: an
  // onConflict-do-nothing insert, so a watermark that already has real data (from this new
  // pipeline actually running) is never clobbered by a stale legacy value on a later call.
  // committedRefreshLastAttemptedAt is always null here -- the legacy vaulted cursor never
  // recorded a timestamp, only the bare Stripe refresh id -- which is safe precisely because
  // nothing in this pipeline ever makes an ordering decision by comparing that timestamp (see
  // the migration's header comment); the next real event still gets its currency confirmed live
  // against the provider, independent of whatever is bootstrapped here.
  async bootstrapWatermarkFromLegacyCursor({ financialAccountId, feature, ownerId, legacyRefreshId }) {
    if (!legacyRefreshId) return;
    const { error } = await this.supabase
      .from("financial_account_refresh_watermarks")
      .upsert(
        {
          financial_account_id: financialAccountId,
          feature,
          owner_id: ownerId,
          committed_refresh_id: legacyRefreshId,
          committed_refresh_last_attempted_at: null,
          committed_at: null,
        },
        { onConflict: "financial_account_id,feature", ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  async claim({ financialAccountId, feature, ownerId, refreshId, refreshLastAttemptedAt, triggeringEventId, leaseSeconds = 300 }) {
    const { data, error } = await this.supabase.rpc("claim_financial_account_refresh_work", {
      p_financial_account_id: financialAccountId,
      p_feature: feature,
      p_owner_id: ownerId,
      p_refresh_id: refreshId,
      p_refresh_last_attempted_at: refreshLastAttemptedAt,
      p_triggering_event_id: triggeringEventId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("claim_financial_account_refresh_work returned no row.");
    return Object.freeze({ outcome: row.outcome, workItemId: row.work_item_id });
  }

  async markImporting({ workItemId }) {
    const { error } = await this.supabase
      .from("financial_account_refresh_work_items")
      .update({ status: "importing", updated_at: new Date().toISOString() })
      .eq("id", workItemId)
      .eq("status", "claimed");
    if (error) throw error;
  }

  async markFailed({ workItemId, failureMessage }) {
    const { error } = await this.supabase
      .from("financial_account_refresh_work_items")
      .update({ status: "failed", failure_message: failureMessage, updated_at: new Date().toISOString() })
      .eq("id", workItemId);
    if (error) throw error;
  }

  async commit({ workItemId, financialAccountId, feature, ownerId, refreshId, refreshLastAttemptedAt }) {
    const { data, error } = await this.supabase.rpc("commit_financial_account_refresh_work", {
      p_work_item_id: workItemId,
      p_financial_account_id: financialAccountId,
      p_feature: feature,
      p_owner_id: ownerId,
      p_refresh_id: refreshId,
      p_refresh_last_attempted_at: refreshLastAttemptedAt,
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("commit_financial_account_refresh_work returned no row.");
    return Object.freeze({ outcome: row.outcome, supersededByRefreshId: row.superseded_by_refresh_id ?? null });
  }
}

Object.freeze(SupabaseFinancialAccountRefreshRepository);
