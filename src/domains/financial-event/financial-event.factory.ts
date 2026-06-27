import type { FinancialEvent } from "./financial-event.types";
import type { ResolvedRentecImportRecord } from "../rentec-import";

export class FinancialEventFactory {
  fromRentec(record: ResolvedRentecImportRecord): FinancialEvent {
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

      property_id: record.resolvedProperty.id,
      financial_account_id: null,

      event_date: record.date,

      description: record.description,

      amount: record.amount,

      transaction_kind: record.knowledge.transactionKind,
      normalized_category: record.knowledge.normalizedCategory,

      tax_deductible: record.knowledge.taxDeductible,
      affects_noi: record.knowledge.affectsNOI,
      capitalized: record.knowledge.capitalized,

      source_system: "rentec",
      source_record_id: null,

      metadata: {
        property: record.property,
        propertyName: record.resolvedProperty.name,
        sourceCategory: record.sourceCategory,
        rawRow: record.rawRow,
      },
    };
  }
}

export const financialEventFactory = new FinancialEventFactory();
