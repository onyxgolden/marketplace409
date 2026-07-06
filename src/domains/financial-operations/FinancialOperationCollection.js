export class FinancialOperationCollection {
  constructor(operations = []) {
    this.operations = Object.freeze([...operations]);

    Object.freeze(this);
  }

  static empty() {
    return new FinancialOperationCollection([]);
  }

  get count() {
    return this.operations.length;
  }

  toArray() {
    return this.operations;
  }
}

Object.freeze(FinancialOperationCollection);
