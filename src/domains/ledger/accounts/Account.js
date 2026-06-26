import { AccountClassification } from "./AccountClassification";
import { AccountType } from "./AccountType";

export class Account {
  constructor({ id, name, type, classification = null }) {
    if (!id) {
      throw new Error("Account id is required");
    }

    if (!name) {
      throw new Error("Account name is required");
    }

    if (!Object.values(AccountType).includes(type)) {
      throw new Error("Account type is invalid");
    }

    if (
      classification !== null &&
      !Object.values(AccountClassification).includes(classification)
    ) {
      throw new Error("Account classification is invalid");
    }

    this.id = id;
    this.name = name;
    this.type = type;
    this.classification = classification;

    Object.freeze(this);
  }

  isDebitNormal() {
    return this.type === AccountType.ASSET || this.type === AccountType.EXPENSE;
  }

  isCreditNormal() {
    return (
      this.type === AccountType.LIABILITY ||
      this.type === AccountType.EQUITY ||
      this.type === AccountType.REVENUE
    );
  }

  hasClassification(classification) {
    return this.classification === classification;
  }
}
