import { AccountingPeriodRepository } from "./AccountingPeriodRepository";

/**
 * InMemoryAccountingPeriodRepository
 *
 * Infrastructure implementation used for tests, local development,
 * and future service-layer wiring before database persistence exists.
 */
export class InMemoryAccountingPeriodRepository extends AccountingPeriodRepository {
  constructor(periods = []) {
    super();

    this._periods = new Map(
      periods.map(period => [period.id, period])
    );
  }

  findById(id) {
    return this._periods.get(id);
  }

  save(period) {
    this._periods.set(period.id, period);
  }
}
