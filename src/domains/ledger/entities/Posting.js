import { Money } from "@/platform";
import { LedgerDirection } from "../value-objects";

export class Posting {
  constructor({
    id,
    accountId,
    amount,
    direction,
    description = "",
    metadata = {},
  }) {
    if (!id) throw new Error("Posting requires an id");
    if (!accountId) throw new Error("Posting requires an accountId");

    if (!(amount instanceof Money)) {
      throw new Error("Posting amount must be a Money object");
    }

    if (!Object.values(LedgerDirection).includes(direction)) {
      throw new Error("Posting direction must be DEBIT or CREDIT");
    }

    this.id = id;
    this.accountId = accountId;
    this.amount = amount;
    this.direction = direction;
    this.description = description;
    this.metadata = metadata;
  }

  isDebit() {
    return this.direction === LedgerDirection.DEBIT;
  }

  isCredit() {
    return this.direction === LedgerDirection.CREDIT;
  }

  toJSON() {
    return {
      id: this.id,
      accountId: this.accountId,
      amount: this.amount.toJSON(),
      direction: this.direction,
      description: this.description,
      metadata: this.metadata,
    };
  }
}
