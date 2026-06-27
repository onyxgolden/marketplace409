import { categoryNormalizer } from "../knowledge";
import { PropertyResolverService } from "../property/property-resolver.service";
import type {
  RentecImportRecord,
  ResolvedRentecImportRecord,
} from "./rentec-import.types";

export class RentecSemanticResolver {
  resolve(record: RentecImportRecord): ResolvedRentecImportRecord {
    const resolvedProperty = PropertyResolverService.fromSourceName({
      sourceName: record.property,
      sourceSystem: "rentec",
    });

    return {
      date: record.date,
      description: record.description,
      amount: record.amount,
      resolvedProperty,
      knowledge: categoryNormalizer.normalize(record.description),
      sourceSystem: "rentec",
      sourceRecordId: null,
      metadata: {
        property: record.property,
        propertyName: resolvedProperty.name,
        sourceCategory: record.sourceCategory,
        rawRow: record.rawRow,
      },
    };
  }

  resolveMany(records: RentecImportRecord[]): ResolvedRentecImportRecord[] {
    if (!Array.isArray(records)) {
      throw new Error("Rentec import records must be an array");
    }

    return records.map((record) => this.resolve(record));
  }
}

export const rentecSemanticResolver = new RentecSemanticResolver();
