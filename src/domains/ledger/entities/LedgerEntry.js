import { Money } from "@/platform";
import { LedgerDirection } from "../value-objects";

export class LedgerEntry {
  constructor({
    id,
    accountId,
    amount,
    direction,
    description = "",
    metadata = {},
    createdAt = new Date(),
  }) {
    if (!id) throw new Error("LedgerEntry requires an id");
    if (!accountId) throw new Error("LedgerEntry requires an accountId");

    if (!(amount instanceof Money)) {
      throw new Error("LedgerEntry amount must be a Money object");
    }

    if (!Object.values(LedgerDirection).includes(direction)) {
      throw new Error("Direction must be DEBIT or CREDIT");
    }

    this.id = id;
    this.accountId = accountId;
    this.amount = amount;
    this.direction = direction;
    this.description = description;
    this.metadata = metadata;
    this.createdAt = createdAt;
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
      createdAt: this.createdAt,
    };
  }
}
