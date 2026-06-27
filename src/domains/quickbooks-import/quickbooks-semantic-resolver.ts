import { categoryNormalizer } from "../knowledge";
import { PropertyResolverService } from "../property/property-resolver.service";
import type {
  QuickBooksImportRecord,
  ResolvedQuickBooksImportRecord,
} from "./quickbooks-import.types";

export class QuickBooksSemanticResolver {
  resolve(record: QuickBooksImportRecord): ResolvedQuickBooksImportRecord {
    const sourcePropertyName = record.property ?? "Unassigned";

    const resolvedProperty = PropertyResolverService.fromSourceName({
      sourceName: sourcePropertyName,
      sourceSystem: "quickbooks",
    });

    const semanticDescription =
      record.category ?? record.account ?? record.description;

    return {
      date: record.date,
      description: record.description,
      amount: record.amount,
      resolvedProperty,
      knowledge: categoryNormalizer.normalize(semanticDescription),
      sourceSystem: "quickbooks",
      sourceRecordId: record.sourceRecordId ?? null,
      metadata: {
        account: record.account,
        category: record.category,
        property: record.property,
        rawRow: record.rawRow,
      },
    };
  }

  resolveMany(
    records: QuickBooksImportRecord[],
  ): ResolvedQuickBooksImportRecord[] {
    if (!Array.isArray(records)) {
      throw new Error("QuickBooks import records must be an array");
    }

    return records.map((record) => this.resolve(record));
  }
}

export const quickBooksSemanticResolver = new QuickBooksSemanticResolver();
