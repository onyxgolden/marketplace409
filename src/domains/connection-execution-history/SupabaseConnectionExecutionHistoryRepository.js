export class SupabaseConnectionExecutionHistoryRepository {
  constructor(options = {}) {
    if (!options.supabaseClient) {
      throw new Error(
        "Supabase client is required",
      );
    }

    this.supabaseClient =
      options.supabaseClient;
  }

  async save(executionHistory, context) {
    const ownerId =
      this.requireOwnerId(context);

    const { data, error } =
      await this.supabaseClient
        .from(
          "connection_execution_history",
        )
        .upsert(
          this.toRow(
            executionHistory,
            ownerId,
          ),
          {
            onConflict: "id",
          },
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    return Object.freeze(data);
  }

  async findByConnectionId(
    connectionId,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(context);

    const { data, error } =
      await this.supabaseClient
        .from(
          "connection_execution_history",
        )
        .select("*")
        .eq("owner_id", ownerId)
        .eq(
          "connection_id",
          connectionId,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        );

    if (error) {
      throw error;
    }

    return Object.freeze(data || []);
  }

  async findByOwnerId(context) {
    const ownerId =
      this.requireOwnerId(context);

    const { data, error } =
      await this.supabaseClient
        .from(
          "connection_execution_history",
        )
        .select("*")
        .eq("owner_id", ownerId)
        .order(
          "created_at",
          {
            ascending: false,
          },
        );

    if (error) {
      throw error;
    }

    return Object.freeze(data || []);
  }

  async findRecentByOwnerId(
    limit,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(context);

    const { data, error } =
      await this.supabaseClient
        .from(
          "connection_execution_history",
        )
        .select("*")
        .eq("owner_id", ownerId)
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    return Object.freeze(data || []);
  }

  requireOwnerId(context) {
    const ownerId =
      context?.ownerId;

    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Connection execution history owner id is required",
      );
    }

    return ownerId;
  }

  toRow(
    executionHistory,
    ownerId,
  ) {
    return {
      id: executionHistory.id,
      owner_id: ownerId,
      connection_id:
        executionHistory.connectionId,
      operation_type:
        executionHistory.operationType,
      status:
        executionHistory.status,
      provider:
        executionHistory.provider,
      started_at:
        executionHistory.startedAt,
      completed_at:
        executionHistory.completedAt,
      metrics:
        executionHistory.metrics,
      error_details:
        executionHistory.errorDetails,
      created_at:
        executionHistory.createdAt,
    };
  }
}

Object.freeze(
  SupabaseConnectionExecutionHistoryRepository,
);
