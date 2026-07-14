import { describe, expect, test } from "vitest";

import { financialEventPostingAdapter } from "../financial-event-posting.adapter";
import { JournalEntry } from "../../ledger/entities";

describe("FinancialEventPostingAdapter", () => {
  test("creates a balanced journal entry for rental income", () => {
    const event = {
      id: "evt-1",
      event_date: "2026-01-01",
      description: "Rental Income",
      amount: 1500,
      transaction_kind: "income",
      normalized_category: "rental_income",
      tax_deductible: false,
      affects_noi: true,
      capitalized: false,
    };

    const entry = financialEventPostingAdapter.toJournalEntry(event);

    expect(entry).toBeInstanceOf(JournalEntry);
    expect(entry.postings).toHaveLength(2);

    expect(entry.getDebitTotal().amount).toBe(150000);
    expect(entry.getCreditTotal().amount).toBe(150000);

    expect(entry.postings[0].accountId).toBe("1000");
    expect(entry.postings[1].accountId).toBe("4000");
  });

  test("posts late fee income to cash and rental income", () => {
    const event = {
      id: "evt-late-fee",
      event_date: "2026-01-05",
      description: "Late Fee Income",
      amount: 35,
      transaction_kind: "income",
      normalized_category: "rental_income",
      tax_deductible: false,
      affects_noi: true,
      capitalized: false,
    };

    const entry = financialEventPostingAdapter.toJournalEntry(event);

    expect(entry.getDebitTotal().amount).toBe(3500);
    expect(entry.getCreditTotal().amount).toBe(3500);

    expect(entry.postings[0].accountId).toBe("1000");
    expect(entry.postings[1].accountId).toBe("4000");
    expect(entry.postings.map((posting) => posting.accountId)).not.toContain(
      "5999"
    );
  });

  test("creates a balanced journal entry for a real estate purchase", () => {
    const event = {
      id: "evt-2",
      event_date: "2026-01-02",
      description: "Purchase Price",
      amount: 25000,
      transaction_kind: "asset_purchase",
      normalized_category: "real_estate_purchase",
      tax_deductible: false,
      affects_noi: false,
      capitalized: true,
    };

    const entry = financialEventPostingAdapter.toJournalEntry(event);

    expect(entry.getDebitTotal().amount).toBe(2500000);
    expect(entry.getCreditTotal().amount).toBe(2500000);

    expect(entry.postings[0].accountId).toBe("1500");
    expect(entry.postings[1].accountId).toBe("1000");
  });
});
