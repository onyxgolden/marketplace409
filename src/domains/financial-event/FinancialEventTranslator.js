export class FinancialEventTranslator {
  /**
   * Canonical temporal accessor (current system reality)
   */
  static getOccurredAt(event) {
    return event.event_date;
  }

  static getEventDate(event) {
    return event.event_date;
  }

  /**
   * Non-breaking validation only (no transformation)
   */
  static validate(event) {
    if (!event) throw new Error("FinancialEvent is required");
    if (!event.event_date) throw new Error("Missing event_date");
    if (event.amount == null) throw new Error("Missing amount");

    return true;
  }
}
