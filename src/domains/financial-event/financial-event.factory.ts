import type { FinancialEvent } from "./financial-event.types";
import type { RentecImportRecord } from "../rentec-import";
import { categoryNormalizer } from "../knowledge";

export class FinancialEventFactory {
  fromRentec(record: RentecImportRecord): FinancialEvent {
    const knowledge = categoryNormalizer.normalize(record.description);

    return {
      id: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),

      created_by: null,
      updated_by: null,

      owner_id: null,
      organization_id: null,

      status: "active",

      is_deleted: false,
      deleted_at: null,

      property_id: null,
      financial_account_id: null,

      event_date: record.date,

      description: record.description,

      amount: record.amount,

      transaction_kind: knowledge.transactionKind,
      normalized_category: knowledge.normalizedCategory,

      tax_deductible: knowledge.taxDeductible,
      affects_noi: knowledge.affectsNOI,
      capitalized: knowledge.capitalized,

      source_system: "rentec",
      source_record_id: null,

      metadata: {
        property: record.property,
        sourceCategory: record.sourceCategory,
        rawRow: record.rawRow,
      },
    };
  }
}

export const financialEventFactory = new FinancialEventFactory();

