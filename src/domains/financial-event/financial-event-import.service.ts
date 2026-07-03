import { categoryNormalizer } from "../knowledge";
import { PropertyResolverService } from "../property/property-resolver.service";
import type { Transaction } from "../transaction/transaction.types";
import { financialEventFactory } from "./financial-event.factory";
import type {
  FinancialEvent,
  ResolvedFinancialEventInput,
} from "./financial-event.types";
import {
  toFinancialEventImportResult,
  type FinancialEventImportInput,
  type FinancialEventImportResult,
} from "./financial-event-import.types";

type FinancialEventRepositoryLike = {
  saveMany(events: FinancialEvent[]): FinancialEvent[];
};

type CategoryNormalizerLike = {
  normalize(description: string): ResolvedFinancialEventInput["knowledge"];
};

type PropertyResolverLike = {
  resolveTransaction(input: {
    transaction: Transaction;
    ownerId?: string | null;
    organizationId?: string | null;
  }): {
    property: ResolvedFinancialEventInput["resolvedProperty"];
  };
};

type FinancialEventFactoryLike = {
  fromResolvedInput(
    record: ResolvedFinancialEventInput,
    ownerId?: string | null,
  ): FinancialEvent;
};

export class FinancialEventImportService {
  private readonly repository: FinancialEventRepositoryLike;
  private readonly normalizer: CategoryNormalizerLike;
  private readonly propertyResolver: PropertyResolverLike;
  private readonly factory: FinancialEventFactoryLike;
  private readonly ownerId: string | null;

  constructor({
    repository,
    normalizer = categoryNormalizer,
    propertyResolver = PropertyResolverService,
    factory = financialEventFactory,
    ownerId = null,
  }: {
    repository: FinancialEventRepositoryLike;
    normalizer?: CategoryNormalizerLike;
    propertyResolver?: PropertyResolverLike;
    factory?: FinancialEventFactoryLike;
    ownerId?: string | null;
  }) {
    this.repository = repository;
    this.normalizer = normalizer;
    this.propertyResolver = propertyResolver;
    this.factory = factory;
    this.ownerId = ownerId;
  }

  import(
    input: FinancialEventImportInput,
  ): FinancialEventImportResult {
    if (!input.readyForFinancialEventImport) {
      throw new Error("Transaction import result is not ready for financial event import");
    }

    const financialEvents = input.transactions.map((transaction) =>
      this.toFinancialEvent(transaction),
    );

    const persistedFinancialEvents =
      this.repository.saveMany(financialEvents);

    return toFinancialEventImportResult(input, persistedFinancialEvents);
  }

  private toFinancialEvent(transaction: Transaction): FinancialEvent {
    const semanticDescription =
      transaction.merchantName ??
      transaction.description;

    const resolvedInput: ResolvedFinancialEventInput = {
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amountCents,
      resolvedProperty: this.propertyResolver.resolveTransaction({
        transaction,
        ownerId: this.ownerId,
      }).property,
      knowledge: this.normalizer.normalize(semanticDescription),
      sourceSystem: "transaction",
      sourceRecordId: transaction.id,
      metadata: {
        connectionId: transaction.connectionId,
        financialAccountId: transaction.financialAccountId,
        provider: transaction.provider,
        providerAccountId: transaction.providerAccountId,
        providerTransactionId: transaction.providerTransactionId,
        currencyCode: transaction.currencyCode,
        category: [...transaction.category],
        pending: transaction.pending,
        merchantName: transaction.merchantName,
        raw: transaction.raw,
      },
    };

    return this.factory.fromResolvedInput(resolvedInput, this.ownerId);
  }
}
