export class FinancialEventNormalizer {
  /**
   * Normalize ANY incoming financial event into canonical domain shape.
   *
   * Supports:
   * - snake_case (Rentec, CSV imports)
   * - camelCase (internal system)
   */
  normalize(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Invalid financial event input");
    }

    return {
      id: input.id ?? "",

      ownerId: input.ownerId ?? input.owner_id,

      eventDate: input.eventDate ?? input.event_date,

      description: input.description,

      amount: input.amount,

      transactionKind: input.transactionKind ?? input.transaction_kind,

      normalizedCategory:
        input.normalizedCategory ?? input.normalized_category,

      taxDeductible: input.taxDeductible ?? input.tax_deductible,

      affectsNoi: input.affectsNoi ?? input.affects_noi,

      capitalized: input.capitalized,

      sourceSystem: input.sourceSystem ?? input.source_system,
    };
  }

  normalizeMany(inputs) {
    if (!Array.isArray(inputs)) {
      throw new Error("normalizeMany expects an array");
    }

    return inputs.map((i) => this.normalize(i));
  }
}
