import { describe, expect, test } from "vitest";
import { AccountClassification } from "../AccountClassification";

describe("AccountClassification", () => {
  test("defines stable ledger account classifications", () => {
    expect(AccountClassification.CURRENT_ASSET).toBe("current_asset");
    expect(AccountClassification.FIXED_ASSET).toBe("fixed_asset");
    expect(AccountClassification.CASH).toBe("cash");
    expect(AccountClassification.ACCOUNTS_RECEIVABLE).toBe(
      "accounts_receivable",
    );
    expect(AccountClassification.INVENTORY).toBe("inventory");

    expect(AccountClassification.CURRENT_LIABILITY).toBe("current_liability");
    expect(AccountClassification.LONG_TERM_LIABILITY).toBe(
      "long_term_liability",
    );

    expect(AccountClassification.COST_OF_GOODS_SOLD).toBe(
      "cost_of_goods_sold",
    );
    expect(AccountClassification.OPERATING_EXPENSE).toBe("operating_expense");
    expect(AccountClassification.NON_OPERATING_EXPENSE).toBe(
      "non_operating_expense",
    );

    expect(AccountClassification.OPERATING_REVENUE).toBe("operating_revenue");
    expect(AccountClassification.OTHER_REVENUE).toBe("other_revenue");
  });

  test("account classifications are immutable", () => {
    expect(Object.isFrozen(AccountClassification)).toBe(true);
  });
});
