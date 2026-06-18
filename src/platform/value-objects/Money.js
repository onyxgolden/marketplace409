export class Money {
  constructor(amount, currency = "USD") {
    if (!Number.isInteger(amount)) {
      throw new Error(
        "Money amount must be stored as the smallest currency unit (integer)."
      );
    }

    this.amount = amount;
    this.currency = currency;

    Object.freeze(this);
  }

  add(other) {
    this.#assertSameCurrency(other);

    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other) {
    this.#assertSameCurrency(other);

    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(multiplier) {
    return new Money(
      Math.round(this.amount * multiplier),
      this.currency
    );
  }

  divide(divisor) {
    if (divisor === 0) {
      throw new Error("Cannot divide by zero.");
    }

    return new Money(
      Math.round(this.amount / divisor),
      this.currency
    );
  }

  equals(other) {
    return (
      this.amount === other.amount &&
      this.currency === other.currency
    );
  }

  isZero() {
    return this.amount === 0;
  }

  isPositive() {
    return this.amount > 0;
  }

  isNegative() {
    return this.amount < 0;
  }

  toDecimal() {
    return this.amount / 100;
  }

  toString() {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.currency,
    }).format(this.toDecimal());
  }

  #assertSameCurrency(other) {
    if (this.currency !== other.currency) {
      throw new Error("Currency mismatch.");
    }
  }
}
