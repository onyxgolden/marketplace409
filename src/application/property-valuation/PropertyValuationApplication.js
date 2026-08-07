import {
  createPropertyValuation,
} from "@/domains/property-valuation/property-valuation.types";

function readField(row, ...names) {
  for (const name of names) {
    const value = row?.[name];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return null;
}

function dollarsToCents(value) {
  const normalized =
    typeof value === "string"
      ? value.replace(/[$,\s]/g, "")
      : value;

  const amount = Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "Property valuation amount must be a nonnegative number.",
    );
  }

  const amountCents = Math.round(amount * 100);

  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(
      "Property valuation amount exceeds the supported range.",
    );
  }

  return amountCents;
}

function normalizeTimestamp(value, fallback) {
  const timestamp =
    value == null || String(value).trim() === ""
      ? fallback
      : String(value).trim();

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(
      "Property valuation effective date must be a valid timestamp.",
    );
  }

  return new Date(timestamp).toISOString();
}

function freezeArray(values) {
  return Object.freeze([...values]);
}

export class PropertyValuationApplication {
  constructor(
    repository,
    options = {},
  ) {
    if (!repository) {
      throw new Error(
        "PropertyValuationApplication requires a repository.",
      );
    }

    this.repository = repository;
    this.clock =
      options.clock ??
      (() => new Date().toISOString());
    this.idFactory =
      options.idFactory ??
      (() => crypto.randomUUID());
  }

  createValuation(input, context) {
    const createdAt =
      normalizeTimestamp(
        this.clock(),
        new Date().toISOString(),
      );

    const propertyId =
      readField(
        input,
        "propertyId",
        "property_id",
      );

    if (!propertyId) {
      throw new Error(
        "Property valuation property ID is required.",
      );
    }

    const amount =
      readField(
        input,
        "amount",
        "amountDollars",
        "currentValue",
        "current_value",
        "value",
      );

    if (amount == null) {
      throw new Error(
        "Property valuation amount is required.",
      );
    }

    const source =
      context.source;

    return createPropertyValuation({
      id:
        input.id ??
        `property_valuation_${this.idFactory()}`,
      propertyId: String(propertyId).trim(),
      valuationType: String(
        readField(
          input,
          "valuationType",
          "valuation_type",
        ) ?? "owner_estimate",
      ).trim(),
      source,
      providerName:
        readField(
          input,
          "providerName",
          "provider_name",
        ) == null
          ? null
          : String(
              readField(
                input,
                "providerName",
                "provider_name",
              ),
            ).trim(),
      providerReference:
        readField(
          input,
          "providerReference",
          "provider_reference",
        ) == null
          ? null
          : String(
              readField(
                input,
                "providerReference",
                "provider_reference",
              ),
            ).trim(),
      amountCents: dollarsToCents(amount),
      currencyCode: String(
        readField(
          input,
          "currencyCode",
          "currency_code",
        ) ?? "USD",
      ).trim(),
      effectiveAt: normalizeTimestamp(
        readField(
          input,
          "effectiveAt",
          "effective_at",
          "valuationDate",
          "valuation_date",
        ),
        createdAt,
      ),
      createdAt,
      notes:
        readField(input, "notes") == null
          ? null
          : String(
              readField(input, "notes"),
            ).trim(),
    });
  }

  async listLatest(ownerId) {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Property valuation owner ID is required.",
      );
    }

    const valuations =
      await this.repository.findLatestByOwnerId(
        ownerId.trim(),
      );

    return freezeArray(valuations);
  }

  async recordManual(input, ownerId) {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Property valuation owner ID is required.",
      );
    }

    const valuation =
      this.createValuation(
        input,
        {
          source: "manual",
        },
      );

    return this.repository.save(
      valuation,
      {
        ownerId: ownerId.trim(),
      },
    );
  }

  previewSpreadsheetRows(rows) {
    if (!Array.isArray(rows)) {
      throw new Error(
        "Property valuation spreadsheet rows are required.",
      );
    }

    const valuations = [];
    const errors = [];

    rows.forEach((row, index) => {
      try {
        valuations.push(
          this.createValuation(
            row,
            {
              source: "spreadsheet",
            },
          ),
        );
      } catch (error) {
        errors.push(
          Object.freeze({
            rowNumber: index + 2,
            message:
              error instanceof Error
                ? error.message
                : "Unable to validate property valuation row.",
          }),
        );
      }
    });

    return Object.freeze({
      valid: errors.length === 0,
      rowCount: rows.length,
      validRowCount: valuations.length,
      invalidRowCount: errors.length,
      valuations: freezeArray(valuations),
      errors: freezeArray(errors),
    });
  }

  async importSpreadsheetRows(
    rows,
    ownerId,
  ) {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim() === ""
    ) {
      throw new Error(
        "Property valuation owner ID is required.",
      );
    }

    const preview =
      this.previewSpreadsheetRows(rows);

    if (!preview.valid) {
      return Object.freeze({
        ...preview,
        importedCount: 0,
        persistedValuations:
          freezeArray([]),
      });
    }

    const persistedValuations =
      await this.repository.saveMany(
        preview.valuations,
        {
          ownerId: ownerId.trim(),
        },
      );

    return Object.freeze({
      ...preview,
      importedCount:
        persistedValuations.length,
      persistedValuations:
        freezeArray(
          persistedValuations,
        ),
    });
  }
}

Object.freeze(PropertyValuationApplication);
