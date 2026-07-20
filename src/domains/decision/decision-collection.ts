import { Decision } from "./decision";

export type DecisionCollectionInput = Readonly<{
  items: readonly Decision[];
}>;

export class DecisionCollection {
  readonly items: readonly Decision[];

  readonly openCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly completedCount: number;
  readonly completionPercentage: number;

  constructor({ items }: DecisionCollectionInput) {
    if (!Array.isArray(items)) {
      throw new Error(
        "DecisionCollection items must be an array",
      );
    }

    this.items = Object.freeze([...items]);

    let openCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;
    let completedCount = 0;

    for (const item of this.items) {
      if (!(item instanceof Decision)) {
        throw new Error(
          "DecisionCollection items must be Decision instances",
        );
      }

      switch (item.status) {
        case "open":
          openCount++;
          break;

        case "accepted":
          acceptedCount++;
          break;

        case "rejected":
          rejectedCount++;
          break;

        case "completed":
          completedCount++;
          break;
      }
    }

    const total = this.items.length;

    this.openCount = openCount;
    this.acceptedCount = acceptedCount;
    this.rejectedCount = rejectedCount;
    this.completedCount = completedCount;

    this.completionPercentage =
      total === 0 ? 0 : completedCount / total;

    Object.freeze(this);
  }

  toJSON() {
    return {
      items: this.items,
      openCount: this.openCount,
      acceptedCount: this.acceptedCount,
      rejectedCount: this.rejectedCount,
      completedCount: this.completedCount,
      completionPercentage: this.completionPercentage,
    };
  }
}
