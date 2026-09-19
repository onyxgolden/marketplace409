// Pure helper for POST /api/financial/reconcile-transfers: builds the exact RPC
// payloads for applying the CURRENT preview. Kept free of server imports so it
// is unit-testable.
//
// Sign convention (see classifyTransferPairs.js + correctRawBankFeedDirection.js):
// - directionFixes: income corrections are positive magnitudes -> Math.abs.
// - internalTransfers: signed direction must survive -> inbound stays negative,
//   outbound stays positive. Math.abs is NOT applied here; without this, a
//   confirmed pair is written back with both legs positive and the classifier
//   (which splits inbound/outbound by sign) can never pair it again.
//   Defensively forces the sign rather than trusting the preview's sign, so a
//   re-apply over already-absolutized rows still heals them.
// - distributions: income/expense legs are positive magnitudes -> Math.abs.
// - debtPayments: the depository leg (outbound) is a real, budget-visible expense
//   (heloc_payment/loan_payment/...) -> positive magnitude; the loan leg (inbound)
//   is written as a signed negative internal_transfer so the pair stays re-pairable
//   on the next preview instead of being absolutized into unpairable mush.
export function buildApplyPayloads(preview) {
  const payloads = [];
  for (const entry of preview.directionFixes ?? []) {
    payloads.push({
      eventId: entry.eventId,
      transactionKind: "income",
      normalizedCategory: "other",
      pAmount: Math.abs(entry.amount),
    });
  }
  for (const pair of preview.internalTransfers ?? []) {
    payloads.push({
      eventId: pair.inbound.eventId,
      transactionKind: "transfer",
      normalizedCategory: "internal_transfer",
      pAmount: -Math.abs(pair.inbound.amount),
    });
    payloads.push({
      eventId: pair.outbound.eventId,
      transactionKind: "transfer",
      normalizedCategory: "internal_transfer",
      pAmount: Math.abs(pair.outbound.amount),
    });
  }
  for (const pair of preview.distributions ?? []) {
    payloads.push({
      eventId: pair.inbound.eventId,
      transactionKind: "income",
      normalizedCategory: "owner_distribution",
      pAmount: Math.abs(pair.inbound.amount),
    });
    payloads.push({
      eventId: pair.outbound.eventId,
      transactionKind: "expense",
      normalizedCategory: "owner_distribution",
      pAmount: Math.abs(pair.outbound.amount),
    });
  }
  for (const pair of preview.debtPayments ?? []) {
    payloads.push({
      eventId: pair.outbound.eventId,
      transactionKind: "expense",
      normalizedCategory: pair.expenseCategory,
      pAmount: Math.abs(pair.outbound.amount),
    });
    payloads.push({
      eventId: pair.inbound.eventId,
      transactionKind: "transfer",
      normalizedCategory: "internal_transfer",
      pAmount: -Math.abs(pair.inbound.amount),
    });
  }
  return payloads;
}
