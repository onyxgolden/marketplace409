import { AccountingPeriod } from "../entities";

export class AccountingPeriodService {
  constructor(repository) {
    if (!repository) {
      throw new Error("AccountingPeriodService requires a repository");
    }

    this.repository = repository;
  }

  createPeriod(data) {
    return new AccountingPeriod(data);
  }

  savePeriod(period) {
    this.repository.save(period);

    return period;
  }

  getPeriodById(id) {
    return this.repository.findById(id);
  }

  closePeriod(id) {
    const period = this.repository.findById(id);

    if (!period) {
      throw new Error(`AccountingPeriod not found: ${id}`);
    }

    const closedPeriod = new AccountingPeriod({
      ...period.toJSON(),
      isClosed: true,
    });

    this.repository.save(closedPeriod);

    return closedPeriod;
  }
}
