export class SupabaseDecisionOutcomeRepository {
  constructor({
    supabaseClient,
    ownerId,
  } = {}) {
    if (
      !supabaseClient ||
      typeof supabaseClient.from !== "function"
    ) {
      throw new Error(
        "SupabaseDecisionOutcomeRepository requires a Supabase client.",
      );
    }

    if (
      typeof ownerId !== "string" ||
      ownerId.trim().length === 0
    ) {
      throw new Error(
        "SupabaseDecisionOutcomeRepository requires an owner id.",
      );
    }

    this.supabaseClient = supabaseClient;
    this.ownerId = ownerId;

    Object.freeze(this);
  }

  async save(evaluation) {
    if (
      typeof evaluation !== "object" ||
      evaluation === null ||
      Array.isArray(evaluation)
    ) {
      throw new Error(
        "Decision outcome evaluation must be an object",
      );
    }

    if (
      typeof evaluation.decisionId !== "string" ||
      evaluation.decisionId.length === 0
    ) {
      throw new Error(
        "Decision outcome evaluation decisionId must be a non-empty string",
      );
    }

    const { data, error } = await this.supabaseClient
      .from("decision_outcomes")
      .upsert(this.toRow(evaluation), {
        onConflict: "owner_id,decision_id",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      this.toEvaluation(data),
    );
  }

  async findByDecisionId(decisionId) {
    if (
      typeof decisionId !== "string" ||
      decisionId.length === 0
    ) {
      throw new Error(
        "Decision id must be a non-empty string",
      );
    }

    const { data, error } =
      await this.supabaseClient
        .from("decision_outcomes")
        .select("*")
        .eq("owner_id", this.ownerId)
        .eq("decision_id", decisionId)
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return Object.freeze(
      this.toEvaluation(data),
    );
  }

  toRow(evaluation) {
    return {
      owner_id: this.ownerId,
      decision_id: evaluation.decisionId,
      status: evaluation.status,
      evaluation: evaluation.evaluation,
      outcome: evaluation.outcome,
    };
  }

  toEvaluation(row) {
    return {
      decisionId: row.decision_id,
      status: row.status,
      evaluation: row.evaluation,
      outcome: row.outcome,
    };
  }
}

Object.freeze(
  SupabaseDecisionOutcomeRepository,
);
