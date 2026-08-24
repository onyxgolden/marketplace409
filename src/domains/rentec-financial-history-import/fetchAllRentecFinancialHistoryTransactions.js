// Shared, bounded-pagination fetch for Rentec financial-history transactions across every property.
// Both the preview and approval routes import this so their fetch behavior can never drift apart —
// a truncated fetch behind the preview and a different (or no) cap behind approval would let approval
// act on source data the preview never actually showed.
//
// Fails closed: if a property still reports moreRecords=true after the page cap, the whole fetch
// throws instead of silently returning a partial result. A preview built from a truncated fetch could
// under-report "safe missing" rows; an approval acting on one could write from an incomplete source
// snapshot without ever saying so. Neither is acceptable — both callers must surface this as an error
// rather than proceed.
export const MAX_TRANSACTION_PAGES_PER_PROPERTY = 50;

export async function fetchAllRentecFinancialHistoryTransactions(
  client,
  propertyIds,
  { maxPagesPerProperty = MAX_TRANSACTION_PAGES_PER_PROPERTY } = {},
) {
  const rentecTransactions = [];
  const fetchSummary = [];
  for (const rentecPropertyId of propertyIds) {
    let page = 1;
    let fetched = 0;
    let lastResult = null;
    for (; page <= maxPagesPerProperty; page++) {
      const result = await client.financialHistoryTransactions({ propertyId: rentecPropertyId, page });
      rentecTransactions.push(...result.transactions);
      fetched += result.transactions.length;
      lastResult = result;
      if (!result.moreRecords) break;
    }
    if (lastResult?.moreRecords) {
      throw new Error(
        `Rentec property ${rentecPropertyId} still reports more transaction pages after the ${maxPagesPerProperty}-page safety cap. Refusing to preview or approve from a truncated fetch.`,
      );
    }
    fetchSummary.push({ rentecPropertyId, transactionsFetched: fetched, pagesFetched: Math.min(page, maxPagesPerProperty) });
  }
  return { rentecTransactions, fetchSummary };
}
