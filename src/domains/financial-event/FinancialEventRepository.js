/**
 * FinancialEventRepository
 *
 * Domain repository contract for financial events.
 * Infrastructure implementations must preserve owner boundaries.
 */
export class FinancialEventRepository {
  saveMany(_events) {
    throw new Error("FinancialEventRepository.saveMany must be implemented");
  }

  findByOwnerId(_ownerId) {
    throw new Error("FinancialEventRepository.findByOwnerId must be implemented");
  }

  count() {
    throw new Error("FinancialEventRepository.count must be implemented");
  }
}
