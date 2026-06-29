export class FinancialEventRepositoryContract {
  /**
   * Persist a batch of FinancialEvents.
   *
   * Contract requirements:
   * - Must accept an array of FinancialEvent objects
   * - Must persist all events (atomic behavior in real DBs, in-memory simulation allowed)
   * - Must preserve all event fields (id, ownerId, type, payload, timestamps)
   * - Must return the persisted events as an array
   *
   * This return value is REQUIRED for pipeline continuity.
   *
   * @param {FinancialEvent[]} events
   * @returns {FinancialEvent[]} persisted events
   */
  saveMany(_events) {
    throw new Error("FinancialEventRepository.saveMany must be implemented");
  }

  /**
   * Retrieve events by owner scope (multi-tenant safety boundary)
   */
  findByOwnerId(_ownerId) {
    throw new Error("FinancialEventRepository.findByOwnerId must be implemented");
  }

  /**
   * Debug / test utility
   */
  count() {
    throw new Error("FinancialEventRepository.count must be implemented");
  }

  /**
   * Test isolation helper
   */
  clear() {
    throw new Error("FinancialEventRepository.clear must be implemented");
  }
}
