// Detects and classifies internal-transfer / owner-distribution pairs among raw bank-feed
// (source_system='transaction') rows -- money moved between two of the owner's own accounts (e.g.
// "Transfer to Loan 0020" / "Transfer from Share 0000"), which is neither real income nor a real
// expense unless it crosses the personal/business boundary, in which case it's an owner
// contribution or distribution. No DB access here -- callers fetch rows and pass them in.
//
// isInternalTransferDescription: verified against all 214 production 'transaction' rows -- every
// row whose description contains both "transfer to/from" and "share"/"loan" is a real internal
// transfer; nothing else in that dataset matches. Real examples: "Online Banking Withdrawal /
// Transfer to Loan 0020: ...", "Deposit / Transfer from XP Property Management LLC Share 0000",
// "Withdrawal / Transfer to Jason Daniel Morgan Share 0000".
export function isInternalTransferDescription(description) {
  if (typeof description !== "string") return false;
  return /\btransfer\s+(to|from)\b/i.test(description) && /\b(share|loan)\b/i.test(description);
}

function toCents(amount) {
  return Math.round(Math.abs(amount) * 100);
}

function daysBetween(dateA, dateB) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs((new Date(dateA).getTime() - new Date(dateB).getTime()) / msPerDay);
}

// rows: pre-filtered to isInternalTransferDescription rows only, each
// { id, eventDate, amount (raw signed dollars), businessScope }.
// Direction comes from sign (verified 100% consistent across production data, see
// correctRawBankFeedDirection.js): negative = this account received the money (inbound leg),
// positive = this account sent the money (outbound leg).
//
// Same conservative pairing policy as reconcileTransactionDuplicates.js: exactly one opposite-sign,
// same-amount, in-window candidate on the other side -> confirmed pair; zero, more than one, or a
// row contended for by more than one counterparty -> ambiguous, never auto-resolved.
export function classifyTransferPairs({ rows, toleranceDays = 3 }) {
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  if (!Number.isFinite(toleranceDays) || toleranceDays < 0) throw new Error("toleranceDays must be a non-negative number");

  const inbound = rows.filter((row) => row.amount < 0);
  const outbound = rows.filter((row) => row.amount > 0);

  const candidatesByInboundId = new Map();
  for (const inRow of inbound) {
    const cents = toCents(inRow.amount);
    const candidates = outbound.filter((outRow) => toCents(outRow.amount) === cents && daysBetween(inRow.eventDate, outRow.eventDate) <= toleranceDays);
    candidatesByInboundId.set(inRow.id, candidates);
  }

  const tentativeMatchByInboundId = new Map();
  for (const [inboundId, candidates] of candidatesByInboundId) {
    if (candidates.length === 1) tentativeMatchByInboundId.set(inboundId, candidates[0]);
  }

  const claimantsByOutboundId = new Map();
  for (const [inboundId, outRow] of tentativeMatchByInboundId) {
    const claimants = claimantsByOutboundId.get(outRow.id) ?? [];
    claimants.push(inboundId);
    claimantsByOutboundId.set(outRow.id, claimants);
  }
  const contendedOutboundIds = new Set([...claimantsByOutboundId.entries()].filter(([, claimants]) => claimants.length > 1).map(([id]) => id));

  const internalTransfers = [];
  const distributions = [];
  const ambiguous = [];

  for (const [inboundId, candidates] of candidatesByInboundId) {
    const inRow = inbound.find((row) => row.id === inboundId);

    if (candidates.length === 0) {
      ambiguous.push(Object.freeze({ inboundId, candidateOutboundIds: Object.freeze([]), reason: "no_candidates" }));
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push(Object.freeze({ inboundId, candidateOutboundIds: Object.freeze(candidates.map((c) => c.id)), reason: "multiple_candidates" }));
      continue;
    }

    const outRow = candidates[0];
    if (contendedOutboundIds.has(outRow.id)) {
      ambiguous.push(Object.freeze({ inboundId, candidateOutboundIds: Object.freeze([outRow.id]), reason: "contended_outbound_row" }));
      continue;
    }

    const pair = Object.freeze({ inboundId, outboundId: outRow.id });
    if (inRow.businessScope === outRow.businessScope) {
      internalTransfers.push(pair);
    } else {
      distributions.push(Object.freeze({ ...pair, inboundScope: inRow.businessScope, outboundScope: outRow.businessScope }));
    }
  }

  return Object.freeze({
    internalTransfers: Object.freeze(internalTransfers),
    distributions: Object.freeze(distributions),
    ambiguous: Object.freeze(ambiguous),
  });
}
