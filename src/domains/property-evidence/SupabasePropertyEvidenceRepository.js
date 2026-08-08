function requireIdentifier(
  value,
  message,
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalIdentifier(
  value,
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  return String(value).trim();
}

function evidenceToRow(
  evidence,
  ownerId,
) {
  return {
    owner_id:
      ownerId,
    id:
      evidence.id,
    property_id:
      evidence.propertyId,
    hvac_system_id:
      evidence.hvacSystemId,
    hvac_event_id:
      evidence.hvacEventId,
    bucket:
      evidence.bucket,
    object_path:
      evidence.objectPath,
    original_filename:
      evidence.originalFilename,
    mime_type:
      evidence.mimeType,
    byte_size:
      evidence.byteSize,
    extraction_method:
      evidence.extractionMethod,
    parser_version:
      evidence.parserVersion,
    review_status:
      evidence.reviewStatus,
    created_at:
      evidence.createdAt,
    updated_at:
      evidence.updatedAt,
  };
}

function evidenceRowToDomain(
  row,
) {
  return Object.freeze({
    id:
      row.id,
    ownerId:
      row.owner_id,
    propertyId:
      row.property_id,
    hvacSystemId:
      row.hvac_system_id,
    hvacEventId:
      row.hvac_event_id,
    bucket:
      row.bucket,
    objectPath:
      row.object_path,
    originalFilename:
      row.original_filename,
    mimeType:
      row.mime_type,
    byteSize:
      Number(
        row.byte_size,
      ),
    extractionMethod:
      row.extraction_method,
    parserVersion:
      row.parser_version,
    reviewStatus:
      row.review_status,
    createdAt:
      row.created_at,
    updatedAt:
      row.updated_at,
  });
}

export class SupabasePropertyEvidenceRepository {
  constructor({
    supabaseClient,
  } = {}) {
    if (
      !supabaseClient ||
      typeof supabaseClient.from !==
        "function"
    ) {
      throw new Error(
        "SupabasePropertyEvidenceRepository requires a Supabase client.",
      );
    }

    this.supabase =
      supabaseClient;
  }

  async save(
    evidence,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(
        context?.ownerId,
      );

    if (
      evidence?.ownerId !==
        ownerId
    ) {
      throw new Error(
        "Property evidence owner does not match the persistence context.",
      );
    }

    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_evidence",
      )
      .insert(
        evidenceToRow(
          evidence,
          ownerId,
        ),
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return evidenceRowToDomain(
      data,
    );
  }

  async findById(
    evidenceId,
    ownerId,
  ) {
    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_evidence",
      )
      .select("*")
      .eq(
        "owner_id",
        this.requireOwnerId(
          ownerId,
        ),
      )
      .eq(
        "id",
        requireIdentifier(
          evidenceId,
          "Property evidence id is required.",
        ),
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? evidenceRowToDomain(
          data,
        )
      : null;
  }

  async attachToHVACEvent({
    evidenceId,
    hvacEventId,
    updatedAt,
  }, context) {
    const ownerId =
      this.requireOwnerId(
        context?.ownerId,
      );

    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_evidence",
      )
      .update({
        hvac_event_id:
          requireIdentifier(
            hvacEventId,
            "Property evidence HVAC event id is required.",
          ),
        review_status:
          "approved",
        updated_at:
          requireIdentifier(
            updatedAt,
            "Property evidence update date is required.",
          ),
      })
      .eq(
        "owner_id",
        ownerId,
      )
      .eq(
        "id",
        requireIdentifier(
          evidenceId,
          "Property evidence id is required.",
        ),
      )
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return evidenceRowToDomain(
      data,
    );
  }

  requireOwnerId(
    ownerId,
  ) {
    return requireIdentifier(
      ownerId,
      "Property evidence owner id is required.",
    );
  }
}

export {
  evidenceRowToDomain,
  evidenceToRow,
};

Object.freeze(
  SupabasePropertyEvidenceRepository,
);
