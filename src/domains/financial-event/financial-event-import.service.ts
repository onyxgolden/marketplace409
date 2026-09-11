import { categoryNormalizer } from "../knowledge";
import { PropertyResolverService } from "../property/property-resolver.service";
import type { Transaction } from "../transaction/transaction.types";
import { financialEventFactory } from "./financial-event.factory";
import { CANONICAL_TRANSACTION_AMOUNT_UNIT_VERSION, minorUnitsToDecimalDollars } from "./minorUnitsToDecimalDollars";
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
  saveMany(
    events: FinancialEvent[],
  ):
    | FinancialEvent[]
    | Promise<FinancialEvent[]>;
};

type CategoryNormalizerLike = {
  normalize(description: string): ResolvedFinancialEventInput["knowledge"];
};

type PropertyResolverLike = {
  resolveTransaction(input: {
    transaction: Transaction;
    ownerId?: string | null;
    organizationId?: string | null;
  }): Promise<{
    property: ResolvedFinancialEventInput["resolvedProperty"];
  }>;
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

  async import(
    input: FinancialEventImportInput,
  ): Promise<FinancialEventImportResult> {
    if (!input.readyForFinancialEventImport) {
      throw new Error("Transaction import result is not ready for financial event import");
    }

    const financialEvents = await Promise.all(
      input.transactions.map((transaction) =>
        this.toFinancialEvent(transaction),
      ),
    );

    const persistedFinancialEvents =
      await this.repository.saveMany(
        financialEvents,
      );

    return toFinancialEventImportResult(input, persistedFinancialEvents);
  }

  private async toFinancialEvent(transaction: Transaction): Promise<FinancialEvent> {
    const semanticDescription =
      transaction.merchantName ??
      transaction.description;

    const resolvedInput: ResolvedFinancialEventInput = {
      date: transaction.date,
      description: transaction.description,
      // The Transaction-to-FinancialEvent unit boundary: transaction.amountCents is signed integer
      // minor units (see transaction.types.ts); ResolvedFinancialEventInput.amount is signed decimal
      // dollars (see financial-event.types.ts). This is the ONLY place this conversion happens --
      // neither TransactionMapper nor financial-event.factory.ts nor
      // SupabaseFinancialEventRepository perform any further conversion, and
      // buildFinancialForgePerformance.toCents() on the read side already correctly assumes
      // financial_events.amount is decimal dollars, so this must run exactly once, here.
      amount: minorUnitsToDecimalDollars(transaction.amountCents),
      resolvedProperty: (
        await this.propertyResolver.resolveTransaction({
          transaction,
          ownerId: this.ownerId,
        })
      ).property,
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
        // Structural, immutable record of which Transaction-to-FinancialEvent amount contract wrote
        // this event -- stamped here, at the shared boundary, by the import service itself, never
        // chosen or interpreted by provider-specific mapper code. This is what lets the repair
        // migration (and any future repair) distinguish "written by the current, correct code" from
        // "written before this version existed" using the data itself, safely even if a webhook
        // delivers a new, already-correct event immediately before a repair migration runs.
        amountUnitVersion: CANONICAL_TRANSACTION_AMOUNT_UNIT_VERSION,
      },
    };

    return this.factory.fromResolvedInput(resolvedInput, this.ownerId);
  }
}
