/**
 * AccountingPeriod
 *
 * Immutable domain entity representing a financial reporting period.
 * A period defines the valid accounting window for journal entries.
 * Periods may be open or closed.
 */

export class AccountingPeriod {
  constructor({
    id,
    name,
    startDate,
    endDate,
    isClosed = false,
    createdAt = new Date(),
  }) {
    if (!id) {
      throw new Error("AccountingPeriod requires an id");
    }

    if (!name) {
      throw new Error("AccountingPeriod requires a name");
    }

    if (!startDate) {
      throw new Error("AccountingPeriod requires a startDate");
    }

    if (!endDate) {
      throw new Error("AccountingPeriod requires an endDate");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const created = new Date(createdAt);

    if (Number.isNaN(start.getTime())) {
      throw new Error("AccountingPeriod startDate is invalid");
    }

    if (Number.isNaN(end.getTime())) {
      throw new Error("AccountingPeriod endDate is invalid");
    }

    if (Number.isNaN(created.getTime())) {
      throw new Error("AccountingPeriod createdAt is invalid");
    }

    if (end < start) {
      throw new Error(
        "AccountingPeriod endDate must not precede startDate",
      );
    }

    this.id = id;
    this.name = name;
    this.startDate = start;
    this.endDate = end;
    this.isClosed = Boolean(isClosed);
    this.createdAt = created;

    Object.freeze(this);
  }

  containsDate(date) {
    const value = new Date(date);

    if (Number.isNaN(value.getTime())) {
      throw new Error("AccountingPeriod containsDate requires a valid date");
    }

    return value >= this.startDate && value <= this.endDate;
  }

  isWithin(date) {
    return this.containsDate(date);
  }

  isOpen() {
    return !this.isClosed;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      startDate: this.startDate.toISOString(),
      endDate: this.endDate.toISOString(),
      isClosed: this.isClosed,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
