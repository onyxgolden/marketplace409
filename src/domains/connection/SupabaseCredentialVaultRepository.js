export class SupabaseCredentialVaultRepository {
  constructor(options = {}) {
    if (!options.supabaseClient) {
      throw new Error(
        "Supabase client is required",
      );
    }

    this.supabaseClient =
      options.supabaseClient;
  }

  async store(
    ownerId,
    vaultReference,
    secret,
  ) {
    const now =
      new Date().toISOString();

    const { error } =
      await this.supabaseClient
        .from("credential_vault")
        .upsert(
          {
            owner_id:
              ownerId,
            vault_reference:
              vaultReference,
            secret,
            created_at:
              now,
            updated_at:
              now,
          },
          {
            onConflict:
              "owner_id,vault_reference",
          },
        );

    if (error) {
      throw error;
    }
  }

  async retrieve(
    ownerId,
    vaultReference,
  ) {
    const { data, error } =
      await this.supabaseClient
        .from("credential_vault")
        .select("secret")
        .eq(
          "owner_id",
          ownerId,
        )
        .eq(
          "vault_reference",
          vaultReference,
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.secret ?? null;
  }

  async delete(
    ownerId,
    vaultReference,
  ) {
    const { error } =
      await this.supabaseClient
        .from("credential_vault")
        .delete()
        .eq(
          "owner_id",
          ownerId,
        )
        .eq(
          "vault_reference",
          vaultReference,
        );

    if (error) {
      throw error;
    }

    return true;
  }

  async exists(
    ownerId,
    vaultReference,
  ) {
    const { data, error } =
      await this.supabaseClient
        .from("credential_vault")
        .select(
          "vault_reference",
        )
        .eq(
          "owner_id",
          ownerId,
        )
        .eq(
          "vault_reference",
          vaultReference,
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data !== null;
  }
}

Object.freeze(
  SupabaseCredentialVaultRepository,
);
