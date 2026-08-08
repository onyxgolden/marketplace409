import {
  supabase as defaultSupabase,
} from "@/lib/supabase";

import {
  mapHVACComponentEventRowToDomain,
  mapHVACComponentEventToRow,
  mapHVACComponentRowToDomain,
  mapHVACComponentToRow,
  mapHVACSystemRowToDomain,
  mapHVACSystemToRow,
} from "./property-hvac.mapper";

export class SupabasePropertyHVACRepository {
  constructor(options = {}) {
    this.supabase =
      options.supabaseClient ||
      defaultSupabase;
  }

  async saveSystem(
    system,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(
        context?.ownerId,
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_systems",
        )
        .upsert(
          mapHVACSystemToRow(
            system,
            ownerId,
          ),
          {
            onConflict:
              "owner_id,id",
          },
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapHVACSystemRowToDomain(
        data,
      ),
    );
  }

  async findSystemById(
    systemId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_systems",
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
          this.requireIdentifier(
            systemId,
            "HVAC system id is required.",
          ),
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapHVACSystemRowToDomain(
            data,
          ),
        )
      : null;
  }

  async findSystemsByProperty(
    propertyId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_systems",
        )
        .select("*")
        .eq(
          "owner_id",
          this.requireOwnerId(
            ownerId,
          ),
        )
        .eq(
          "property_id",
          this.requireIdentifier(
            propertyId,
            "HVAC property id is required.",
          ),
        )
        .order("name", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    return this.mapRows(
      data,
      mapHVACSystemRowToDomain,
    );
  }

  async saveComponent(
    component,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(
        context?.ownerId,
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_components",
        )
        .upsert(
          mapHVACComponentToRow(
            component,
            ownerId,
          ),
          {
            onConflict:
              "owner_id,id",
          },
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapHVACComponentRowToDomain(
        data,
      ),
    );
  }

  async findComponentById(
    componentId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_components",
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
          this.requireIdentifier(
            componentId,
            "HVAC component id is required.",
          ),
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    return data
      ? Object.freeze(
          mapHVACComponentRowToDomain(
            data,
          ),
        )
      : null;
  }

  async findComponentsBySystem(
    systemId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_components",
        )
        .select("*")
        .eq(
          "owner_id",
          this.requireOwnerId(
            ownerId,
          ),
        )
        .eq(
          "system_id",
          this.requireIdentifier(
            systemId,
            "HVAC system id is required.",
          ),
        )
        .order("name", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    return this.mapRows(
      data,
      mapHVACComponentRowToDomain,
    );
  }

  async appendComponentEvent(
    event,
    context,
  ) {
    const ownerId =
      this.requireOwnerId(
        context?.ownerId,
      );

    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_component_events",
        )
        .insert(
          mapHVACComponentEventToRow(
            event,
            ownerId,
          ),
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    return Object.freeze(
      mapHVACComponentEventRowToDomain(
        data,
      ),
    );
  }

  async findEventsBySystem(
    systemId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_component_events",
        )
        .select("*")
        .eq(
          "owner_id",
          this.requireOwnerId(
            ownerId,
          ),
        )
        .eq(
          "system_id",
          this.requireIdentifier(
            systemId,
            "HVAC system id is required.",
          ),
        )
        .order("occurred_at", {
          ascending: false,
        });

    if (error) {
      throw error;
    }

    return this.mapRows(
      data,
      mapHVACComponentEventRowToDomain,
    );
  }

  async findEventsByComponent(
    componentId,
    ownerId,
  ) {
    const { data, error } =
      await this.supabase
        .from(
          "property_hvac_component_events",
        )
        .select("*")
        .eq(
          "owner_id",
          this.requireOwnerId(
            ownerId,
          ),
        )
        .eq(
          "component_id",
          this.requireIdentifier(
            componentId,
            "HVAC component id is required.",
          ),
        )
        .order("occurred_at", {
          ascending: false,
        });

    if (error) {
      throw error;
    }

    return this.mapRows(
      data,
      mapHVACComponentEventRowToDomain,
    );
  }

  mapRows(rows, mapper) {
    return Object.freeze(
      (rows || []).map(
        (row) =>
          Object.freeze(
            mapper(row),
          ),
      ),
    );
  }

  requireOwnerId(ownerId) {
    return this.requireIdentifier(
      ownerId,
      "HVAC owner id is required.",
    );
  }

  requireIdentifier(
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
}

Object.freeze(
  SupabasePropertyHVACRepository,
);
