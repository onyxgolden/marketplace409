import {
  supabase as defaultSupabase,
} from "@/lib/supabase";

import {
  mapPropertyOperatingObligationRowToDomain,
  mapPropertyOperatingObligationToRow,
} from "./property-operating-obligation.mapper";

function optionalIdentifier(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).trim() || null;
}

export class SupabasePropertyOperatingObligationRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient ||
      defaultSupabase;

    if (!this.supabase) {
      throw new Error(
        "Property operating obligation Supabase client is required.",
      );
    }
  }

  async save(obligation, context) {
    const saved = await this.saveMany(
      [obligation],
      context,
    );

    return saved[0];
  }

  async saveMany(
    obligations,
    context,
  ) {
    if (!Array.isArray(obligations)) {
      throw new Error(
        "Property operating obligations must be an array.",
      );
    }

    const ownerId =
      this.requireIdentifier(
        context?.ownerId,
        "Property operating obligation owner id is required.",
      );

    if (obligations.length === 0) {
      return Object.freeze([]);
    }

    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_operating_obligations",
      )
      .upsert(
        obligations.map(
          (obligation) =>
            mapPropertyOperatingObligationToRow(
              obligation,
              ownerId,
            ),
        ),
        {
          onConflict: "id",
        },
      )
      .select("*");

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findById(id, ownerId) {
    const requiredId =
      this.requireIdentifier(
        id,
        "Property operating obligation id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );

    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_operating_obligations",
      )
      .select("*")
      .eq(
        "owner_id",
        requiredOwnerId,
      )
      .eq(
        "id",
        requiredId,
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapPropertyOperatingObligationRowToDomain(
            data,
          ),
        )
      : null;
  }

  async list(query = {}, ownerId) {
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );

    let request =
      this.supabase
        .from(
          "property_operating_obligations",
        )
        .select("*")
        .eq(
          "owner_id",
          requiredOwnerId,
        );

    const filters = [
      [
        "property_id",
        query?.propertyId,
      ],
      [
        "scope",
        query?.scope,
      ],
      [
        "obligation_type",
        query?.obligationType,
      ],
      [
        "status",
        query?.status,
      ],
      [
        "recognition_status",
        query?.recognitionStatus,
      ],
    ];

    for (
      const [
        column,
        value,
      ] of filters
    ) {
      const normalizedValue =
        optionalIdentifier(value);

      if (normalizedValue) {
        request =
          request.eq(
            column,
            normalizedValue,
          );
      }
    }

    if (query?.unreconciledOnly) {
      request =
        request.is(
          "reconciled_financial_event_id",
          null,
        );
    }

    const {
      data,
      error,
    } = await request.order(
      "service_period_start",
      {
        ascending: false,
        nullsFirst: false,
      },
    );

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findByProperty(
    propertyId,
    ownerId,
  ) {
    return this.list(
      {
        propertyId:
          this.requireIdentifier(
            propertyId,
            "Property operating obligation property id is required.",
          ),
        scope: "property",
      },
      ownerId,
    );
  }

  async deleteById(id, ownerId) {
    const requiredId =
      this.requireIdentifier(
        id,
        "Property operating obligation id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );

    const {
      data,
      error,
    } = await this.supabase
      .from(
        "property_operating_obligations",
      )
      .delete()
      .eq(
        "owner_id",
        requiredOwnerId,
      )
      .eq(
        "id",
        requiredId,
      )
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapPropertyOperatingObligationRowToDomain(
            data,
          ),
        )
      : null;
  }

  mapRows(rows) {
    return Object.freeze(
      (rows || []).map(
        (row) =>
          Object.freeze(
            mapPropertyOperatingObligationRowToDomain(
              row,
            ),
          ),
      ),
    );
  }

  requireIdentifier(
    value,
    message,
  ) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      throw new Error(message);
    }

    return value.trim();
  }
}

Object.freeze(
  SupabasePropertyOperatingObligationRepository,
);
