import { PropertyId } from "./property-id";
import type { Property } from "./property.types";

export class PropertyResolverService {
  static fromSourceName({
    sourceName,
    sourceSystem = null,
  }: {
    sourceName: string;
    sourceSystem?: string | null;
  }): Property {
    const name = sourceName.trim();

    return {
      id: PropertyId.fromSourceName(name).toString(),
      name,
      sourceSystem,
      sourceName: name,
    };
  }
}
