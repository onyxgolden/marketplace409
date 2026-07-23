import {
  mapConnectionRowToConnection,
} from "./connection.mapper";

export class SupabaseConnectionRepository {
  constructor(options = {}) {
    if (!options.supabaseClient) {
      throw new Error(
        "Supabase client is required",
      );
    }

    this.supabaseClient =
      options.supabaseClient;
  }

  async save(connection, context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("connections")
      .upsert(
        this.toRow(connection, ownerId),
        {
          onConflict: "id",
        },
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapConnectionRowToConnection(data),
    );
  }

  async getById(id, _context) {
    if (!id) {
      throw new Error("Connection id is required");
    }

    const { data, error } = await this.supabaseClient
      .from("connections")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapConnectionRowToConnection(data),
        )
      : null;
  }

  async getAll(context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("connections")
      .select("*")
      .eq("owner_id", ownerId)
      .order("name", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return Object.freeze(
      (data || []).map((row) =>
        Object.freeze(
          mapConnectionRowToConnection(row),
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
        "Connection owner id is required",
      );
    }

    return ownerId;
  }

  toRow(connection, ownerId) {
    if (
      !connection ||
      typeof connection !== "object"
    ) {
      throw new Error("Connection is required");
    }

    return {
      id: connection.id,
      owner_id: ownerId,
      name: connection.name,
      type: connection.type,
      status: connection.status,
      provider: connection.provider,
      credential_reference_id:
        connection.credentialReferenceId ?? null,
      last_imported_at:
        connection.lastImportedAt ?? null,
      created_at: connection.createdAt,
      updated_at: connection.updatedAt,
    };
  }
}

Object.freeze(SupabaseConnectionRepository);
