import { describe, expect, it, vi } from "vitest";
import { createFundTransfer, validateFundTransferInput } from "./fundTransfers";

const validInput = {
  fromAccountId: "acct-1",
  toAccountId: "acct-2",
  eventDate: "2026-09-27",
  amount: 500,
  memo: "Owner draw",
  checkNumber: "1042",
};

describe("validateFundTransferInput", () => {
  it("accepts a well-formed transfer and trims text fields", () => {
    const result = validateFundTransferInput({ ...validInput, memo: "  padded  " });
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.value).toMatchObject({
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      eventDate: "2026-09-27",
      amount: 500,
      memo: "padded",
      checkNumber: "1042",
    });
  });

  it("rejects the same account on both sides", () => {
    const result = validateFundTransferInput({ ...validInput, toAccountId: "acct-1" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("two different accounts");
  });

  it("rejects missing accounts", () => {
    const result = validateFundTransferInput({ ...validInput, fromAccountId: "", toAccountId: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects zero, negative, and non-numeric amounts", () => {
    for (const amount of [0, -50, Number.NaN, "lots"]) {
      const result = validateFundTransferInput({ ...validInput, amount });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("greater than zero");
    }
  });

  it("rejects missing and impossible dates", () => {
    for (const eventDate of ["", "2026-13-01", "2026-02-30", "09/27/2026"]) {
      const result = validateFundTransferInput({ ...validInput, eventDate });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("valid transfer date");
    }
  });

  it("rounds the amount to the cent", () => {
    const result = validateFundTransferInput({ ...validInput, amount: 500.129 });
    expect(result.valid).toBe(true);
    expect(result.value.amount).toBe(500.13);
  });
});

describe("createFundTransfer", () => {
  it("calls the RPC with the transfer payload and maps the result", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        transfer_group_id: "transfer_abc",
        out_event_id: "event-out",
        in_event_id: "event-in",
        from_account_id: "acct-1",
        to_account_id: "acct-2",
        amount: 500,
        event_date: "2026-09-27",
      },
      error: null,
    }));
    const result = await createFundTransfer({ rpc }, {
      fromAccountId: "acct-1",
      toAccountId: "acct-2",
      eventDate: "2026-09-27",
      amount: 500,
      memo: "Owner draw",
      checkNumber: "",
    });
    expect(rpc).toHaveBeenCalledWith("create_fund_transfer", {
      p_from_account_id: "acct-1",
      p_to_account_id: "acct-2",
      p_event: { amount: 500, eventDate: "2026-09-27", memo: "Owner draw", checkNumber: null },
    });
    expect(result).toMatchObject({
      transferGroupId: "transfer_abc",
      outEventId: "event-out",
      inEventId: "event-in",
    });
  });

  it("throws the database's plain-English message on failure", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "The source and destination accounts must be two different accounts." },
    }));
    await expect(createFundTransfer({ rpc }, validInput)).rejects.toThrow(
      "The source and destination accounts must be two different accounts.",
    );
  });
});
