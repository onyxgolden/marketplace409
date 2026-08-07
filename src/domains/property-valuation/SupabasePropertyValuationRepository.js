import { supabase as defaultSupabase } from "@/lib/supabase";

import {
  mapPropertyValuationRowToPropertyValuation,
  mapPropertyValuationToRow,
} from "./property-valuation.mapper";

export class SupabasePropertyValuationRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient || defaultSupabase;
  }

  async save(valuation, context) {
    const saved = await this.saveMany(
      [valuation],
      context,
    );

    return saved[0];
  }

  async saveMany(valuations, context) {
    if (!Array.isArray(valuations)) {
      throw new Error(
        "Property valuations must be an array.",
      );
    }

    if (valuations.length === 0) {
      return Object.freeze([]);
    }

    const ownerId = this.requireIdentifier(
      context?.ownerId,
      "Property valuation owner id is required.",
    );

    const { data, error } = await this.supabase
      .from("property_valuations")
      .insert(
        valuations.map((valuation) =>
          mapPropertyValuationToRow(
            valuation,
            ownerId,
          ),
        ),
      )
      .select("*");

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findById(id, ownerId) {
    const requiredId = this.requireIdentifier(
      id,
      "Property valuation id is required.",
    );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property valuation owner id is required.",
      );

    const { data, error } = await this.supabase
      .from("property_valuations")
      .select("*")
      .eq("owner_id", requiredOwnerId)
      .eq("id", requiredId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapPropertyValuationRowToPropertyValuation(
            data,
          ),
        )
      : null;
  }

  async findByProperty(
    propertyId,
    ownerId,
  ) {
    const requiredPropertyId =
      this.requireIdentifier(
        propertyId,
        "Property valuation property id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property valuation owner id is required.",
      );

    const { data, error } = await this.supabase
      .from("property_valuations")
      .select("*")
      .eq("owner_id", requiredOwnerId)
      .eq("property_id", requiredPropertyId)
      .order("effective_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    return this.mapRows(data);
  }

  async findLatestByProperty(
    propertyId,
    ownerId,
  ) {
    const requiredPropertyId =
      this.requireIdentifier(
        propertyId,
        "Property valuation property id is required.",
      );
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property valuation owner id is required.",
      );

    const { data, error } = await this.supabase
      .from("property_valuations")
      .select("*")
      .eq("owner_id", requiredOwnerId)
      .eq("property_id", requiredPropertyId)
      .order("effective_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapPropertyValuationRowToPropertyValuation(
            data,
          ),
        )
      : null;
  }

  async findLatestByOwnerId(ownerId) {
    const requiredOwnerId =
      this.requireIdentifier(
        ownerId,
        "Property valuation owner id is required.",
      );

    const { data, error } = await this.supabase
      .from("property_valuations")
      .select("*")
      .eq("owner_id", requiredOwnerId)
      .order("effective_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    const latestByProperty = new Map();

    for (const valuation of this.mapRows(data)) {
      if (
        !latestByProperty.has(
          valuation.propertyId,
        )
      ) {
        latestByProperty.set(
          valuation.propertyId,
          valuation,
        );
      }
    }

    return Object.freeze(
      Array.from(latestByProperty.values())
        .sort((left, right) =>
          left.propertyId.localeCompare(
            right.propertyId,
          ),
        ),
    );
  }

  mapRows(rows) {
    return Object.freeze(
      (rows || []).map((row) =>
        Object.freeze(
          mapPropertyValuationRowToPropertyValuation(
            row,
          ),
        ),
      ),
    );
  }

  requireIdentifier(value, message) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      throw new Error(message);
    }

    return value.trim();
  }
}

Object.freeze(SupabasePropertyValuationRepository);
