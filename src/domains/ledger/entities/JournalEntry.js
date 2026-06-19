import { Money } from "@/platform";
import { Posting } from "./Posting";

export class JournalEntry {
  constructor({
    id,
    date,
    description = "",
    postings = [],
    metadata = {},
    createdAt = new Date(),
  }) {
    if (!id) throw new Error("JournalEntry requires an id");
    if (!date) throw new Error("JournalEntry requires a date");

    if (!Array.isArray(postings)) {
      throw new Error("JournalEntry postings must be an array");
    }

    postings.forEach((posting) => {
      if (!(posting instanceof Posting)) {
        throw new Error("JournalEntry postings must contain Posting objects");
      }
    });

    this.id = id;
    this.date = date;
    this.description = description;
    this.postings = postings;
    this.metadata = metadata;
    this.createdAt = createdAt;

    this.validateBalanced();
    Object.freeze(this);
  }

  getDebitTotal() {
    return this.postings
      .filter((posting) => posting.isDebit())
      .reduce((total, posting) => total.add(posting.amount), new Money(0));
  }

  getCreditTotal() {
    return this.postings
      .filter((posting) => posting.isCredit())
      .reduce((total, posting) => total.add(posting.amount), new Money(0));
  }

  validateBalanced() {
    if (this.postings.length < 2) {
      throw new Error("JournalEntry requires at least two postings");
    }

    const debitTotal = this.getDebitTotal();
    const creditTotal = this.getCreditTotal();

    if (!debitTotal.equals(creditTotal)) {
      throw new Error("JournalEntry debits must equal credits");
    }

    return true;
  }

  toJSON() {
    return {
      id: this.id,
      date: this.date,
      description: this.description,
      postings: this.postings.map((posting) => posting.toJSON()),
      metadata: this.metadata,
      createdAt: this.createdAt,
    };
  }
}
