import { PropertyId } from "./property-id";
import type { Property } from "./property.types";
import type { Transaction } from "../transaction/transaction.types";

export type PropertyResolutionStrategy =
  | "explicit_source_name"
  | "transaction_context_unknown";

export type PropertyResolutionResult = Readonly<{
  property: Property;
  strategy: PropertyResolutionStrategy;
  confidence: number;
  explanation: string;
}>;

export type TransactionPropertyResolutionInput = Readonly<{
  transaction: Transaction;
  ownerId?: string | null;
  organizationId?: string | null;
}>;

export class PropertyResolverService {
  static readonly UNKNOWN_PROPERTY_NAME = "Unknown Property";

  static fromSourceName({
    sourceName,
    sourceSystem = null,
  }: {
    sourceName: string;
    sourceSystem?: string | null;
  }): Property {
    return this.resolveFromSourceName({
      sourceName,
      sourceSystem,
    }).property;
  }

  static resolveFromSourceName({
    sourceName,
    sourceSystem = null,
  }: {
    sourceName: string;
    sourceSystem?: string | null;
  }): PropertyResolutionResult {
    const name = sourceName.trim();

    return {
      property: {
        id: PropertyId.fromSourceName(name).toString(),
        name,
        sourceSystem,
        sourceName: name,
      },
      strategy: "explicit_source_name",
      confidence: 1,
      explanation: "Resolved from an explicit source property name.",
    };
  }

  static resolveTransaction({
    transaction,
    ownerId = null,
    organizationId = null,
  }: TransactionPropertyResolutionInput): PropertyResolutionResult {
    const property = this.createUnknownProperty({
      sourceSystem: transaction.provider,
      ownerId,
      organizationId,
    });

    return {
      property,
      strategy: "transaction_context_unknown",
      confidence: 0,
      explanation:
        "No property assignment rule matched the transaction context.",
    };
  }

  private static createUnknownProperty({
    sourceSystem,
    ownerId,
    organizationId,
  }: {
    sourceSystem: string;
    ownerId: string | null;
    organizationId: string | null;
  }): Property {
    return {
      id: PropertyId.fromSourceName(this.UNKNOWN_PROPERTY_NAME).toString(),
      name: this.UNKNOWN_PROPERTY_NAME,
      sourceSystem,
      sourceName: null,
      owner_id: ownerId,
      organization_id: organizationId,
    };
  }
}
