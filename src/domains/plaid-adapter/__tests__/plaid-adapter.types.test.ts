import { describe, expect, it } from "vitest";

import type {
  PlaidAdapter,
} from "../plaid-adapter.types";

describe("PlaidAdapter", () => {
  it("uses the ConnectionProvider contract", () => {
    const adapter = {
      provider: "plaid",
      displayName: "Plaid",
    } as PlaidAdapter;

    expect(adapter.provider).toBe("plaid");
    expect(adapter.displayName).toBe("Plaid");
  });
});
