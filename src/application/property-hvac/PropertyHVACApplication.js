import {
  createHVACComponent,
  createHVACComponentEvent,
  createHVACSystem,
} from "@/domains/property-hvac/property-hvac.types";

function readField(
  value,
  ...names
) {
  for (const name of names) {
    const field =
      value?.[name];

    if (
      field !== undefined &&
      field !== null &&
      String(field).trim() !== ""
    ) {
      return field;
    }
  }

  return null;
}

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

function optionalString(value) {
  return value == null
    ? null
    : String(value).trim() ||
        null;
}

function normalizeTimestamp(
  value,
  fallback,
  message,
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return fallback;
  }

  const timestamp =
    String(value).trim();

  if (
    Number.isNaN(
      Date.parse(timestamp),
    )
  ) {
    throw new Error(message);
  }

  return new Date(
    timestamp,
  ).toISOString();
}

function optionalTimestamp(
  value,
  message,
) {
  return value == null ||
    String(value).trim() === ""
    ? null
    : normalizeTimestamp(
        value,
        null,
        message,
      );
}

function optionalNumber(value) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  return Number(value);
}

function dollarsToCents(value) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const normalized =
    typeof value === "string"
      ? value.replace(
          /[$,\s]/g,
          "",
        )
      : value;

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "HVAC cost must be a nonnegative number.",
    );
  }

  const cents =
    Math.round(
      amount * 100,
    );

  if (
    !Number.isSafeInteger(cents)
  ) {
    throw new Error(
      "HVAC cost exceeds the supported range.",
    );
  }

  return cents;
}

function normalizeCost(
  input,
  centsNames,
  dollarNames,
) {
  const cents =
    readField(
      input,
      ...centsNames,
    );

  if (cents !== null) {
    const amount =
      Number(cents);

    if (
      !Number.isSafeInteger(
        amount,
      ) ||
      amount < 0
    ) {
      throw new Error(
        "HVAC cost cents must be a nonnegative integer.",
      );
    }

    return amount;
  }

  return dollarsToCents(
    readField(
      input,
      ...dollarNames,
    ),
  );
}

function frozen(values) {
  return Object.freeze([
    ...values,
  ]);
}

export class PropertyHVACApplication {
  constructor(
    repository,
    options = {},
  ) {
    if (!repository) {
      throw new Error(
        "PropertyHVACApplication requires a repository.",
      );
    }

    this.repository =
      repository;

    this.clock =
      options.clock ??
      (() =>
        new Date().toISOString());

    this.idFactory =
      options.idFactory ??
      (() =>
        crypto.randomUUID());
  }

  createdAt() {
    return normalizeTimestamp(
      this.clock(),
      new Date().toISOString(),
      "HVAC creation date must be valid.",
    );
  }

  createSystem(input) {
    return createHVACSystem({
      id:
        input.id ??
        `property_hvac_system_${this.idFactory()}`,
      propertyId:
        requireIdentifier(
          String(
            readField(
              input,
              "propertyId",
              "property_id",
            ) ?? "",
          ),
          "HVAC property id is required.",
        ),
      name:
        String(
          readField(
            input,
            "name",
          ) ??
          "Main HVAC",
        ).trim(),
      systemType:
        String(
          readField(
            input,
            "systemType",
            "system_type",
          ) ??
          "unknown",
        ).trim(),
      energySource:
        String(
          readField(
            input,
            "energySource",
            "energy_source",
          ) ??
          "unknown",
        ).trim(),
      refrigerantType:
        optionalString(
          readField(
            input,
            "refrigerantType",
            "refrigerant_type",
          ),
        ),
      tonnage:
        optionalNumber(
          readField(
            input,
            "tonnage",
          ),
        ),
      efficiencyRating:
        optionalString(
          readField(
            input,
            "efficiencyRating",
            "efficiency_rating",
          ),
        ),
      manufacturer:
        optionalString(
          readField(
            input,
            "manufacturer",
          ),
        ),
      modelNumber:
        optionalString(
          readField(
            input,
            "modelNumber",
            "model_number",
          ),
        ),
      serialNumber:
        optionalString(
          readField(
            input,
            "serialNumber",
            "serial_number",
          ),
        ),
      installedAt:
        optionalTimestamp(
          readField(
            input,
            "installedAt",
            "installed_at",
            "installationDate",
          ),
          "HVAC system installation date must be valid.",
        ),
      estimatedAgeYears:
        optionalNumber(
          readField(
            input,
            "estimatedAgeYears",
            "estimated_age_years",
          ),
        ),
      location:
        optionalString(
          readField(
            input,
            "location",
          ),
        ),
      thermostatType:
        optionalString(
          readField(
            input,
            "thermostatType",
            "thermostat_type",
          ),
        ),
      warrantyExpiration:
        optionalTimestamp(
          readField(
            input,
            "warrantyExpiration",
            "warranty_expiration",
          ),
          "HVAC system warranty expiration must be valid.",
        ),
      status:
        String(
          readField(
            input,
            "status",
          ) ??
          "active",
        ).trim(),
      condition:
        String(
          readField(
            input,
            "condition",
          ) ??
          "unknown",
        ).trim(),
      notes:
        optionalString(
          readField(
            input,
            "notes",
          ),
        ),
      createdAt:
        normalizeTimestamp(
          readField(
            input,
            "createdAt",
            "created_at",
          ),
          this.createdAt(),
          "HVAC system creation date must be valid.",
        ),
    });
  }

  createComponent(input) {
    return createHVACComponent({
      id:
        input.id ??
        `property_hvac_component_${this.idFactory()}`,
      systemId:
        requireIdentifier(
          String(
            readField(
              input,
              "systemId",
              "system_id",
            ) ?? "",
          ),
          "HVAC system id is required.",
        ),
      componentType:
        String(
          readField(
            input,
            "componentType",
            "component_type",
          ) ??
          "",
        ).trim(),
      name:
        String(
          readField(
            input,
            "name",
          ) ??
          "",
        ).trim(),
      manufacturer:
        optionalString(
          readField(
            input,
            "manufacturer",
          ),
        ),
      modelNumber:
        optionalString(
          readField(
            input,
            "modelNumber",
            "model_number",
          ),
        ),
      partNumber:
        optionalString(
          readField(
            input,
            "partNumber",
            "part_number",
          ),
        ),
      serialNumber:
        optionalString(
          readField(
            input,
            "serialNumber",
            "serial_number",
          ),
        ),
      installedAt:
        optionalTimestamp(
          readField(
            input,
            "installedAt",
            "installed_at",
          ),
          "HVAC component installation date must be valid.",
        ),
      removedAt:
        optionalTimestamp(
          readField(
            input,
            "removedAt",
            "removed_at",
          ),
          "HVAC component removal date must be valid.",
        ),
      estimatedAgeYears:
        optionalNumber(
          readField(
            input,
            "estimatedAgeYears",
            "estimated_age_years",
          ),
        ),
      condition:
        String(
          readField(
            input,
            "condition",
          ) ??
          "unknown",
        ).trim(),
      status:
        String(
          readField(
            input,
            "status",
          ) ??
          "installed",
        ).trim(),
      estimatedReplacementCostCents:
        normalizeCost(
          input,
          [
            "estimatedReplacementCostCents",
            "estimated_replacement_cost_cents",
          ],
          [
            "estimatedReplacementCost",
            "estimated_replacement_cost",
          ],
        ),
      vendorName:
        optionalString(
          readField(
            input,
            "vendorName",
            "vendor_name",
          ),
        ),
      invoiceReference:
        optionalString(
          readField(
            input,
            "invoiceReference",
            "invoice_reference",
          ),
        ),
      warrantyExpiration:
        optionalTimestamp(
          readField(
            input,
            "warrantyExpiration",
            "warranty_expiration",
          ),
          "HVAC component warranty expiration must be valid.",
        ),
      notes:
        optionalString(
          readField(
            input,
            "notes",
          ),
        ),
      createdAt:
        normalizeTimestamp(
          readField(
            input,
            "createdAt",
            "created_at",
          ),
          this.createdAt(),
          "HVAC component creation date must be valid.",
        ),
    });
  }

  createComponentEvent(input) {
    const photos =
      input?.photoReferences ??
      input?.photo_references ??
      [];

    return createHVACComponentEvent({
      id:
        input.id ??
        `property_hvac_event_${this.idFactory()}`,
      systemId:
        requireIdentifier(
          String(
            readField(
              input,
              "systemId",
              "system_id",
            ) ?? "",
          ),
          "HVAC system id is required.",
        ),
      componentId:
        optionalString(
          readField(
            input,
            "componentId",
            "component_id",
          ),
        ),
      eventType:
        String(
          readField(
            input,
            "eventType",
            "event_type",
          ) ??
          "",
        ).trim(),
      occurredAt:
        normalizeTimestamp(
          readField(
            input,
            "occurredAt",
            "occurred_at",
            "eventDate",
          ),
          this.createdAt(),
          "HVAC component event occurrence date must be valid.",
        ),
      failureSymptoms:
        optionalString(
          readField(
            input,
            "failureSymptoms",
            "failure_symptoms",
          ),
        ),
      workPerformed:
        optionalString(
          readField(
            input,
            "workPerformed",
            "work_performed",
          ),
        ),
      costCents:
        normalizeCost(
          input,
          [
            "costCents",
            "cost_cents",
          ],
          [
            "cost",
            "costDollars",
          ],
        ),
      vendorName:
        optionalString(
          readField(
            input,
            "vendorName",
            "vendor_name",
          ),
        ),
      invoiceReference:
        optionalString(
          readField(
            input,
            "invoiceReference",
            "invoice_reference",
          ),
        ),
      photoReferences:
        photos,
      notes:
        optionalString(
          readField(
            input,
            "notes",
          ),
        ),
      createdAt:
        normalizeTimestamp(
          readField(
            input,
            "createdAt",
            "created_at",
          ),
          this.createdAt(),
          "HVAC component event creation date must be valid.",
        ),
    });
  }

  async saveSystem(
    input,
    ownerId,
  ) {
    return this.repository.saveSystem(
      this.createSystem(input),
      {
        ownerId:
          requireIdentifier(
            ownerId,
            "HVAC owner id is required.",
          ),
      },
    );
  }

  async saveComponent(
    input,
    ownerId,
  ) {
    return this.repository.saveComponent(
      this.createComponent(input),
      {
        ownerId:
          requireIdentifier(
            ownerId,
            "HVAC owner id is required.",
          ),
      },
    );
  }

  async recordComponentEvent(
    input,
    ownerId,
  ) {
    return this.repository
      .appendComponentEvent(
        this.createComponentEvent(
          input,
        ),
        {
          ownerId:
            requireIdentifier(
              ownerId,
              "HVAC owner id is required.",
            ),
        },
      );
  }

  async listSystems(
    propertyId,
    ownerId,
  ) {
    return frozen(
      await this.repository
        .findSystemsByProperty(
          requireIdentifier(
            propertyId,
            "HVAC property id is required.",
          ),
          requireIdentifier(
            ownerId,
            "HVAC owner id is required.",
          ),
        ),
    );
  }

  async getSystemHistory(
    systemId,
    ownerId,
  ) {
    const requiredSystemId =
      requireIdentifier(
        systemId,
        "HVAC system id is required.",
      );

    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "HVAC owner id is required.",
      );

    const system =
      await this.repository
        .findSystemById(
          requiredSystemId,
          requiredOwnerId,
        );

    if (!system) {
      return null;
    }

    const [
      components,
      events,
    ] = await Promise.all([
      this.repository
        .findComponentsBySystem(
          requiredSystemId,
          requiredOwnerId,
        ),
      this.repository
        .findEventsBySystem(
          requiredSystemId,
          requiredOwnerId,
        ),
    ]);

    return Object.freeze({
      system,
      components:
        frozen(components),
      events:
        frozen(events),
    });
  }
}
