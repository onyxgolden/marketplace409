export class AccountingPeriodValidator {
  constructor({ accountingPeriodService } = {}) {
    if (!accountingPeriodService) {
      throw new Error(
        "AccountingPeriodValidator requires an AccountingPeriodService",
      );
    }

    this.accountingPeriodService = accountingPeriodService;
  }

  validateDateIsPostable(date) {
    const period = this.accountingPeriodService.getPeriodForDate(date);

    if (!period) {
      throw new Error(
        `JournalEntry date is outside an accounting period: ${date}`,
      );
    }

    if (!period.isOpen()) {
      throw new Error(
        `JournalEntry date belongs to a closed accounting period: ${period.id}`,
      );
    }

    return true;
  }
}
