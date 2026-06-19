import { describe, expect, test } from "vitest";
import { AccountType } from "../AccountType";

describe("AccountType", () => {
  test("defines standard accounting account types", () => {
    expect(AccountType.ASSET).toBe("asset");
    expect(AccountType.LIABILITY).toBe("liability");
    expect(AccountType.EQUITY).toBe("equity");
    expect(AccountType.REVENUE).toBe("revenue");
    expect(AccountType.EXPENSE).toBe("expense");
  });
});

test("account types are immutable", () => {
  expect(Object.isFrozen(AccountType)).toBe(true);
});
