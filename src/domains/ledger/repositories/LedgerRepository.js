/**
 * LedgerRepository
 *
 * Abstract repository contract for ledger history.
 * Balance engines and reporting engines depend on this contract,
 * not on a specific storage implementation.
 */

export class LedgerRepository {
  getEntries() {
    throw new Error("LedgerRepository.getEntries must be implemented");
  }

  getEntriesByAccountId(accountId) {
    throw new Error("LedgerRepository.getEntriesByAccountId must be implemented");
  }

  count() {
    throw new Error("LedgerRepository.count must be implemented");
  }

  isEmpty() {
    throw new Error("LedgerRepository.isEmpty must be implemented");
  }
}
