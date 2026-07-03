export function toLedgerPostingInput(financialEventImportResult) {
  if (!financialEventImportResult?.readyForLedgerPosting) {
    throw new Error("Financial event import result is not ready for ledger posting");
  }

  return Object.freeze({
    connectionId: financialEventImportResult.connectionId,
    provider: financialEventImportResult.provider,
    financialEvents: Object.freeze([
      ...financialEventImportResult.financialEvents,
    ]),
    financialEventsImportedAt:
      financialEventImportResult.financialEventsImportedAt,
    readyForLedgerPosting: true,
  });
}
