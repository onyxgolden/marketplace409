import {
  mapCredentialReferenceRowToCredentialReference,
} from "./credential-reference.mapper";

export class SupabaseCredentialReferenceRepository {
  constructor(options = {}) {
    if (!options.supabaseClient) {
      throw new Error(
        "Supabase client is required",
      );
    }

    this.supabaseClient =
      options.supabaseClient;
  }

  async save(credentialReference, context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("credential_references")
      .upsert(
        this.toRow(
          credentialReference,
          ownerId,
        ),
        {
          onConflict:
            "owner_id,provider,external_credential_id",
        },
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapCredentialReferenceRowToCredentialReference(
        data,
      ),
    );
  }

  async getById(id, _context) {
    if (!id) {
      throw new Error(
        "Credential reference id is required",
      );
    }

    const { data, error } = await this.supabaseClient
      .from("credential_references")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapCredentialReferenceRowToCredentialReference(
            data,
          ),
        )
      : null;
  }

  async getAll(context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("credential_references")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return Object.freeze(
      (data || []).map((row) =>
        Object.freeze(
          mapCredentialReferenceRowToCredentialReference(
            row,
          ),
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
        "Credential reference owner id is required",
      );
    }

    return ownerId;
  }

  toRow(
    credentialReference,
    ownerId,
  ) {
    if (
      !credentialReference ||
      typeof credentialReference !== "object"
    ) {
      throw new Error(
        "Credential reference is required",
      );
    }

    return {
      id: credentialReference.id,
      owner_id: ownerId,
      provider: credentialReference.provider,
      external_credential_id:
        credentialReference.externalCredentialId,
      vault_reference:
        credentialReference.vaultReference,
      status: credentialReference.status,
      last_validated_at:
        credentialReference.lastValidatedAt ?? null,
      expires_at:
        credentialReference.expiresAt ?? null,
      created_at:
        credentialReference.createdAt,
      updated_at:
        credentialReference.updatedAt,
    };
  }
}

Object.freeze(
  SupabaseCredentialReferenceRepository,
);
