import { describe, expect, test } from "vitest";
import { toLedgerPostingInput } from "../ledger-posting.types";

describe("ledger posting types", () => {
  test("creates a ledger-owned posting input from a financial event import result", () => {
    const financialEvent = {
      id: "event-1",
      amount: 100,
    };

    const input = toLedgerPostingInput({
      connectionId: "connection-1",
      provider: "canonical-provider",
      financialEvents: [financialEvent],
      financialEventsImportedAt: "2026-07-01T00:05:00.000Z",
      readyForLedgerPosting: true,
    });

    expect(input.connectionId).toBe("connection-1");
    expect(input.provider).toBe("canonical-provider");
    expect(input.financialEvents).toEqual([financialEvent]);
    expect(input.financialEventsImportedAt).toBe("2026-07-01T00:05:00.000Z");
    expect(input.readyForLedgerPosting).toBe(true);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.financialEvents)).toBe(true);
  });

  test("rejects input that is not ready for ledger posting", () => {
    expect(() => toLedgerPostingInput({})).toThrow(
      "Financial event import result is not ready for ledger posting",
    );
  });
});
