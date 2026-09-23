import { supabase } from "@/lib/supabase";

import { FinancialSnapshot } from "./FinancialSnapshot.js";
import { FinancialSnapshotRepository } from "./FinancialSnapshotRepository.js";

export class SupabaseFinancialSnapshotRepository extends FinancialSnapshotRepository {
  async save(snapshot) {
    // The table is RLS-protected and owner-scoped: the insert policy requires
    // owner_id = auth.uid(), so the row must carry the authenticated user.
    // Fail closed when there is no signed-in user rather than writing an
    // ownerless row nobody (including the caller) could ever read back.
    const ownerId = await this.resolveOwnerId();
    const { data, error } = await supabase
      .from("financial_snapshots")
      .upsert(this.toRow(snapshot, ownerId))
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return this.toSnapshot(data);
  }

  async resolveOwnerId() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) {
      throw new Error(
        "Authenticated user is required to save a financial snapshot.",
      );
    }

    return user.id;
  }

  async list() {
    const { data, error } = await supabase
      .from("financial_snapshots")
      .select("*")
      .order("captured_at", { ascending: true });

    if (error) {
      throw error;
    }

    return Object.freeze((data || []).map((row) => this.toSnapshot(row)));
  }

  async findById(id) {
    const { data, error } = await supabase
      .from("financial_snapshots")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? this.toSnapshot(data) : null;
  }

  async findLatest() {
    const { data, error } = await supabase
      .from("financial_snapshots")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? this.toSnapshot(data) : null;
  }

  toRow(snapshot, ownerId = null) {
    return {
      id: snapshot.id,
      owner_id: ownerId,
      captured_at: snapshot.capturedAt,
      period_start: snapshot.period?.start || null,
      period_end: snapshot.period?.end || null,
      kpis: snapshot.kpis,
      health: snapshot.health,
      metadata: snapshot.metadata,
      snapshot: {
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        period: snapshot.period,
        kpis: snapshot.kpis,
        health: snapshot.health,
        metadata: snapshot.metadata,
      },
    };
  }

  toSnapshot(row) {
    const snapshot = row.snapshot || {};

    return new FinancialSnapshot({
      id: snapshot.id || row.id,
      capturedAt: snapshot.capturedAt || row.captured_at,
      period: snapshot.period || {
        start: row.period_start,
        end: row.period_end,
      },
      kpis: snapshot.kpis || row.kpis,
      health: snapshot.health || row.health,
      metadata: snapshot.metadata || row.metadata,
    });
  }
}

Object.freeze(SupabaseFinancialSnapshotRepository);
