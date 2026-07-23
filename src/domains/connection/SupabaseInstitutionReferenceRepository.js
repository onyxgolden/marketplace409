import {
  mapInstitutionReferenceRowToInstitutionReference,
} from "./institution-reference.mapper";

export class SupabaseInstitutionReferenceRepository {
  constructor(options = {}) {
    if (!options.supabaseClient) {
      throw new Error(
        "Supabase client is required",
      );
    }

    this.supabaseClient =
      options.supabaseClient;
  }

  async save(institutionReference, context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("institution_references")
      .upsert(
        this.toRow(
          institutionReference,
          ownerId,
        ),
        {
          onConflict:
            "owner_id,connection_id,id",
        },
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapInstitutionReferenceRowToInstitutionReference(
        data,
      ),
    );
  }

  async getById(id, _context) {
    if (!id) {
      throw new Error(
        "Institution reference id is required",
      );
    }

    const { data, error } = await this.supabaseClient
      .from("institution_references")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapInstitutionReferenceRowToInstitutionReference(
            data,
          ),
        )
      : null;
  }

  async getAll(context) {
    const ownerId = this.requireOwnerId(context);

    const { data, error } = await this.supabaseClient
      .from("institution_references")
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
          mapInstitutionReferenceRowToInstitutionReference(
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
        "Institution reference owner id is required",
      );
    }

    return ownerId;
  }

  toRow(
    institutionReference,
    ownerId,
  ) {
    if (
      !institutionReference ||
      typeof institutionReference !== "object"
    ) {
      throw new Error(
        "Institution reference is required",
      );
    }

    return {
      id: institutionReference.id,
      owner_id: ownerId,
      connection_id:
        institutionReference.connectionId,
      name: institutionReference.name,
      type: institutionReference.type,
      provider: institutionReference.provider,
      external_institution_id:
        institutionReference.externalInstitutionId ??
        null,
      website_url:
        institutionReference.websiteUrl ?? null,
      logo_url:
        institutionReference.logoUrl ?? null,
      created_at:
        institutionReference.createdAt,
      updated_at:
        institutionReference.updatedAt,
    };
  }
}

Object.freeze(
  SupabaseInstitutionReferenceRepository,
);
