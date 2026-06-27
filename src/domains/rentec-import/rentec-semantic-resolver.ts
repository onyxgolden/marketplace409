import { categoryNormalizer } from "../knowledge";
import { PropertyResolverService } from "../property/property-resolver.service";
import type {
  RentecImportRecord,
  ResolvedRentecImportRecord,
} from "./rentec-import.types";

export class RentecSemanticResolver {
  resolve(record: RentecImportRecord): ResolvedRentecImportRecord {
    return {
      ...record,
      resolvedProperty: PropertyResolverService.fromSourceName({
        sourceName: record.property,
        sourceSystem: "rentec",
      }),
      knowledge: categoryNormalizer.normalize(record.description),
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
