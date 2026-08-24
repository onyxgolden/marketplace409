import { describe, expect, it, vi } from "vitest";
import { fetchAllRentecFinancialHistoryTransactions, MAX_TRANSACTION_PAGES_PER_PROPERTY } from "./fetchAllRentecFinancialHistoryTransactions.js";

function txn(id) {
  return { transactionId: id, splitId: null, propertyId: "10", amountCents: 100 };
}

describe("fetchAllRentecFinancialHistoryTransactions (RENTEC-01-FIX #2)", () => {
  it("fetches a single page per property when moreRecords is false immediately", async () => {
    const client = { financialHistoryTransactions: vi.fn(async () => ({ page: 1, moreRecords: false, transactions: [txn("1")] })) };
    const { rentecTransactions, fetchSummary } = await fetchAllRentecFinancialHistoryTransactions(client, ["10"]);
    expect(rentecTransactions).toEqual([txn("1")]);
    expect(fetchSummary).toEqual([{ rentecPropertyId: "10", transactionsFetched: 1, pagesFetched: 1 }]);
    expect(client.financialHistoryTransactions).toHaveBeenCalledTimes(1);
  });

  it("paginates a property until moreRecords is false, within the cap", async () => {
    const client = { financialHistoryTransactions: vi.fn()
      .mockResolvedValueOnce({ page: 1, moreRecords: true, transactions: [txn("1")] })
      .mockResolvedValueOnce({ page: 2, moreRecords: false, transactions: [txn("2")] }) };
    const { rentecTransactions, fetchSummary } = await fetchAllRentecFinancialHistoryTransactions(client, ["10"]);
    expect(rentecTransactions).toEqual([txn("1"), txn("2")]);
    expect(fetchSummary).toEqual([{ rentecPropertyId: "10", transactionsFetched: 2, pagesFetched: 2 }]);
  });

  it("fetches every property independently and concatenates their transactions", async () => {
    const client = { financialHistoryTransactions: vi.fn(async ({ propertyId }) => ({ page: 1, moreRecords: false, transactions: [txn(`${propertyId}-1`)] })) };
    const { rentecTransactions, fetchSummary } = await fetchAllRentecFinancialHistoryTransactions(client, ["10", "11"]);
    expect(rentecTransactions.map((t) => t.transactionId)).toEqual(["10-1", "11-1"]);
    expect(fetchSummary.map((s) => s.rentecPropertyId)).toEqual(["10", "11"]);
  });

  // Exactly at the cap: the final page (== maxPagesPerProperty) reports moreRecords: false, so the
  // fetch completes normally right at the boundary rather than being treated as truncated.
  it("boundary: completes normally when moreRecords becomes false exactly on the last allowed page", async () => {
    const maxPagesPerProperty = 3;
    const client = { financialHistoryTransactions: vi.fn()
      .mockResolvedValueOnce({ page: 1, moreRecords: true, transactions: [txn("1")] })
      .mockResolvedValueOnce({ page: 2, moreRecords: true, transactions: [txn("2")] })
      .mockResolvedValueOnce({ page: 3, moreRecords: false, transactions: [txn("3")] }) };
    const { rentecTransactions, fetchSummary } = await fetchAllRentecFinancialHistoryTransactions(client, ["10"], { maxPagesPerProperty });
    expect(rentecTransactions).toHaveLength(3);
    expect(fetchSummary).toEqual([{ rentecPropertyId: "10", transactionsFetched: 3, pagesFetched: 3 }]);
    expect(client.financialHistoryTransactions).toHaveBeenCalledTimes(3);
  });

  // Overflow beyond the cap: moreRecords is STILL true after the last allowed page - this must fail
  // closed rather than silently returning a truncated result.
  it("boundary: fails closed with a clear error when moreRecords is still true after the page cap", async () => {
    const maxPagesPerProperty = 2;
    const client = { financialHistoryTransactions: vi.fn(async () => ({ page: 1, moreRecords: true, transactions: [txn("1")] })) };
    await expect(fetchAllRentecFinancialHistoryTransactions(client, ["10"], { maxPagesPerProperty }))
      .rejects.toThrow(/property 10 .* more transaction pages .* 2-page safety cap/);
    expect(client.financialHistoryTransactions).toHaveBeenCalledTimes(2);
  });

  it("stops fetching further properties once an earlier property overflows the cap", async () => {
    const maxPagesPerProperty = 1;
    const client = { financialHistoryTransactions: vi.fn(async () => ({ page: 1, moreRecords: true, transactions: [] })) };
    await expect(fetchAllRentecFinancialHistoryTransactions(client, ["10", "11"], { maxPagesPerProperty })).rejects.toThrow();
    expect(client.financialHistoryTransactions).toHaveBeenCalledTimes(1);
  });

  it("defaults maxPagesPerProperty to the exported MAX_TRANSACTION_PAGES_PER_PROPERTY constant", async () => {
    expect(MAX_TRANSACTION_PAGES_PER_PROPERTY).toBe(50);
    const client = { financialHistoryTransactions: vi.fn(async () => ({ page: 1, moreRecords: false, transactions: [] })) };
    await fetchAllRentecFinancialHistoryTransactions(client, ["10"]);
    expect(client.financialHistoryTransactions).toHaveBeenCalledWith({ propertyId: "10", page: 1 });
  });
});
