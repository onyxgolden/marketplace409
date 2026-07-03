import { describe, expect, test } from "vitest";
import { InMemoryGeneralLedgerRepository } from "../../repositories/InMemoryGeneralLedgerRepository";
import { toLedgerPostingInput } from "../../results";
import { LedgerPostingResult } from "../../results/LedgerPostingResult";
import { LedgerPostingService } from "../LedgerPostingService";

function createFinancialEvent(overrides = {}) {
  return {
    id: "event-1",
    event_date: "2026-07-01",
    description: "Repairs",
    amount: 125,
    transaction_kind: "expense",
    normalized_category: "property_repairs",
    tax_deductible: true,
    affects_noi: true,
    capitalized: false,
    source_system: "transaction",
    source_record_id: "transaction-1",
    metadata: {},
    ...overrides,
  };
}

describe("LedgerPostingService", () => {
  test("posts financial events into the general ledger", () => {
    const ledgerRepository = new InMemoryGeneralLedgerRepository();
    const service = new LedgerPostingService({ ledgerRepository });

    const input = toLedgerPostingInput({
      connectionId: "connection-1",
      provider: "canonical-provider",
      financialEvents: [createFinancialEvent()],
      financialEventsImportedAt: "2026-07-01T00:05:00.000Z",
      readyForLedgerPosting: true,
    });

    const result = service.post(input);

    expect(result).toBeInstanceOf(LedgerPostingResult);
    expect(result.readyForFinancialReports).toBe(true);
    expect(result.financialEventCount).toBe(1);
    expect(result.journalEntryCount).toBe(1);
    expect(result.postingResultCount).toBe(1);
    expect(result.ledgerEntryCount).toBe(2);

    const savedLedger = ledgerRepository.load();

    expect(savedLedger.count()).toBe(2);
    expect(result.ledger).toBe(savedLedger);
    expect(result.metadata).toEqual({
      source: "LedgerPostingService",
      connectionId: "connection-1",
      provider: "canonical-provider",
      financialEventsImportedAt: "2026-07-01T00:05:00.000Z",
    });
  });

  test("preserves immutable ledger history when posting multiple events", () => {
    const ledgerRepository = new InMemoryGeneralLedgerRepository();
    const service = new LedgerPostingService({ ledgerRepository });

    const input = toLedgerPostingInput({
      connectionId: "connection-1",
      provider: "canonical-provider",
      financialEvents: [
        createFinancialEvent({ id: "event-1", amount: 125 }),
        createFinancialEvent({ id: "event-2", amount: 200 }),
      ],
      financialEventsImportedAt: "2026-07-01T00:05:00.000Z",
      readyForLedgerPosting: true,
    });

    const result = service.post(input);

    expect(result.financialEventCount).toBe(2);
    expect(result.journalEntryCount).toBe(2);
    expect(result.postingResultCount).toBe(2);
    expect(result.ledgerEntryCount).toBe(4);
    expect(ledgerRepository.load().count()).toBe(4);
  });

  test("rejects input that is not ready for ledger posting", () => {
    const ledgerRepository = new InMemoryGeneralLedgerRepository();
    const service = new LedgerPostingService({ ledgerRepository });

    expect(() => service.post({})).toThrow(
      "Ledger posting input is not ready for ledger posting",
    );
  });
});
