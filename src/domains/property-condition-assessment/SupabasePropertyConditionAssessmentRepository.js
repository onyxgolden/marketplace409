import {
  supabase as defaultSupabase,
} from "@/lib/supabase";

import {
  mapPropertyConditionAssessmentRecordToDomain,
  mapPropertyConditionAssessmentToRecord,
} from "./property-condition-assessment.mapper";

const ASSESSMENT_SELECT =
  "*, property_condition_assessment_items(*)";

export class SupabasePropertyConditionAssessmentRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient ||
      defaultSupabase;
  }

  async save(assessment, context) {
    const ownerId =
      this.requireIdentifier(
        context?.ownerId,
        "Property condition assessment owner id is required.",
      );

    const record =
      mapPropertyConditionAssessmentToRecord(
        assessment,
        ownerId,
      );

    const { error } =
      await this.supabase.rpc(
        "save_property_condition_assessment",
        {
          p_owner_id: ownerId,
          p_assessment:
            record.assessment,
          p_items:
            record.items,
        },
      );

    if (error) {
      throw error;
    }

    const saved =
      await this.findById(
        assessment.id,
        ownerId,
      );

    if (!saved) {
      throw new Error(
        "Saved property condition assessment could not be loaded.",
      );
    }

    return saved;
  }

  async findById(id, ownerId) {
    const requiredId =
      this.requireIdentifier(
        id,
        "Property condition assessment id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_condition_assessments",
        )
        .select(ASSESSMENT_SELECT)
        .eq(
          "owner_id",
          requiredOwnerId,
        )
        .eq("id", requiredId)
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? this.mapAggregateRow(data)
      : null;
  }

  async findByProperty(
    propertyId,
    ownerId,
  ) {
    const requiredPropertyId =
      this.requireIdentifier(
        propertyId,
        "Property condition assessment property id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_condition_assessments",
        )
        .select(ASSESSMENT_SELECT)
        .eq(
          "owner_id",
          requiredOwnerId,
        )
        .eq(
          "property_id",
          requiredPropertyId,
        )
        .order("effective_at", {
          ascending: false,
        });

    if (error) {
      throw error;
    }

    return this.mapAggregateRows(data);
  }

  async findLatestByProperty(
    propertyId,
    ownerId,
  ) {
    const requiredPropertyId =
      this.requireIdentifier(
        propertyId,
        "Property condition assessment property id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_condition_assessments",
        )
        .select(ASSESSMENT_SELECT)
        .eq(
          "owner_id",
          requiredOwnerId,
        )
        .eq(
          "property_id",
          requiredPropertyId,
        )
        .order("effective_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? this.mapAggregateRow(data)
      : null;
  }

  async findLatestByOwnerId(ownerId) {
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_condition_assessments",
        )
        .select(ASSESSMENT_SELECT)
        .eq(
          "owner_id",
          requiredOwnerId,
        )
        .order("effective_at", {
          ascending: false,
        });

    if (error) {
      throw error;
    }

    const latestByProperty =
      new Map();

    for (
      const assessment of
        this.mapAggregateRows(data)
    ) {
      if (
        !latestByProperty.has(
          assessment.propertyId,
        )
      ) {
        latestByProperty.set(
          assessment.propertyId,
          assessment,
        );
      }
    }

    return Object.freeze(
      Array.from(
        latestByProperty.values(),
      ).sort(
        (left, right) =>
          left.propertyId.localeCompare(
            right.propertyId,
          ),
      ),
    );
  }

  mapAggregateRow(row) {
    const {
      property_condition_assessment_items:
        itemRows = [],
      ...assessmentRow
    } = row;

    return Object.freeze(
      mapPropertyConditionAssessmentRecordToDomain({
        assessment:
          assessmentRow,
        items:
          [...itemRows].sort(
            (left, right) =>
              left.id.localeCompare(
                right.id,
              ),
          ),
      }),
    );
  }

  mapAggregateRows(rows) {
    return Object.freeze(
      (rows || []).map((row) =>
        this.mapAggregateRow(row),
      ),
    );
  }

  requireIdentifier(value, message) {
    if (
      typeof value !== "string" ||
      value.trim() === ""
    ) {
      throw new Error(message);
    }

    return value.trim();
  }
}

Object.freeze(
  SupabasePropertyConditionAssessmentRepository,
);
