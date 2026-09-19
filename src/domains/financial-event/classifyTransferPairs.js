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

function ambiguityReason(candidateCount) {
  if (candidateCount === 0) return "no_candidates";
  if (candidateCount > 1) return "multiple_candidates";
  // Exactly one candidate on this row's own side, but the pairing still didn't confirm -- the
  // candidate's own candidate list doesn't point back uniquely at this row (it's contended by, or
  // itself ambiguous toward, some other row on the opposite side).
  return "contended_counterparty";
}

// rows: pre-filtered to isInternalTransferDescription rows only, each
// { id, eventDate, amount (raw signed dollars), businessScope, isLoanAccount }.
// Direction comes from sign (verified 100% consistent across production data, see
// correctRawBankFeedDirection.js): negative = this account received the money (inbound leg),
// positive = this account sent the money (outbound leg).
// isLoanAccount: true when the leg's own financial_accounts.type === 'credit' (a loan/HELOC/credit
// line, not a plain checking/savings account). A transfer INTO a loan account is real debt service
// (money leaving the household, paying down a real balance) -- economically nothing like a
// checking-to-savings shuffle, even though both are "Transfer to/from Share/Loan NNNN" in the raw
// description. Confirmed against production: "Home Equity" (type=credit) receiving a recurring
// "Transfer from Share 0000" alongside "Regular Savings Account" sending a matching "Transfer to
// Loan 0020" is the household's actual HELOC payment -- treating it as a no-op internal transfer
// would make a real, recurring expense permanently invisible to budgeting.
//
// Matching is symmetric and conservative: a pair only confirms when each side is the OTHER side's
// sole candidate (mutual uniqueness). Any row -- inbound or outbound -- left out of a confirmed
// pair surfaces in `ambiguous`; none are silently dropped just because no inbound row happened to
// claim them (an outbound-only row with zero inbound candidates is exactly as reportable as an
// inbound row with zero outbound candidates).
export function classifyTransferPairs({ rows, toleranceDays = 3 }) {
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  if (!Number.isFinite(toleranceDays) || toleranceDays < 0) throw new Error("toleranceDays must be a non-negative number");

  const inbound = rows.filter((row) => row.amount < 0);
  const outbound = rows.filter((row) => row.amount > 0);
  const inboundById = new Map(inbound.map((row) => [row.id, row]));
  const outboundById = new Map(outbound.map((row) => [row.id, row]));

  const isWithinWindow = (a, b) => toCents(a.amount) === toCents(b.amount) && daysBetween(a.eventDate, b.eventDate) <= toleranceDays;

  const inboundCandidates = new Map();
  for (const inRow of inbound) {
    inboundCandidates.set(inRow.id, outbound.filter((outRow) => isWithinWindow(inRow, outRow)));
  }

  // Derived by inversion of inboundCandidates (the matching predicate is symmetric, so this is
  // exactly the same relation viewed from the outbound side) rather than a second filter pass.
  const outboundCandidates = new Map(outbound.map((outRow) => [outRow.id, []]));
  for (const [inboundId, candidates] of inboundCandidates) {
    for (const outRow of candidates) {
      outboundCandidates.get(outRow.id).push(inboundById.get(inboundId));
    }
  }

  const confirmedInboundIds = new Set();
  const confirmedOutboundIds = new Set();
  const confirmedPairs = [];

  for (const [inboundId, candidates] of inboundCandidates) {
    if (candidates.length !== 1) continue;
    const outRow = candidates[0];
    const outboundSideCandidates = outboundCandidates.get(outRow.id);
    // Mutual uniqueness: this outbound row must ALSO see exactly this one inbound row as its sole
    // candidate. If it sees others too, it's contended -- confirm neither.
    if (outboundSideCandidates.length !== 1) continue;
    confirmedPairs.push(Object.freeze({ inboundId, outboundId: outRow.id }));
    confirmedInboundIds.add(inboundId);
    confirmedOutboundIds.add(outRow.id);
  }

  const internalTransfers = [];
  const distributions = [];
  const debtPayments = [];
  for (const pair of confirmedPairs) {
    const inRow = inboundById.get(pair.inboundId);
    const outRow = outboundById.get(pair.outboundId);
    // Checked before the scope split -- a payment into a loan account is real debt service
    // regardless of whether both legs happen to share a business_scope (the common case: personal
    // savings paying a personal HELOC) or not.
    if (inRow.isLoanAccount || outRow.isLoanAccount) {
      debtPayments.push(pair);
    } else if (inRow.businessScope === outRow.businessScope) {
      internalTransfers.push(pair);
    } else {
      distributions.push(Object.freeze({ ...pair, inboundScope: inRow.businessScope, outboundScope: outRow.businessScope }));
    }
  }

  const ambiguous = [];
  for (const inRow of inbound) {
    if (confirmedInboundIds.has(inRow.id)) continue;
    const candidates = inboundCandidates.get(inRow.id);
    ambiguous.push(
      Object.freeze({
        side: "inbound",
        eventId: inRow.id,
        candidateIds: Object.freeze(candidates.map((c) => c.id)),
        reason: ambiguityReason(candidates.length),
      }),
    );
  }
  for (const outRow of outbound) {
    if (confirmedOutboundIds.has(outRow.id)) continue;
    const candidates = outboundCandidates.get(outRow.id);
    ambiguous.push(
      Object.freeze({
        side: "outbound",
        eventId: outRow.id,
        candidateIds: Object.freeze(candidates.map((c) => c.id)),
        reason: ambiguityReason(candidates.length),
      }),
    );
  }

  return Object.freeze({
    internalTransfers: Object.freeze(internalTransfers),
    distributions: Object.freeze(distributions),
    debtPayments: Object.freeze(debtPayments),
    ambiguous: Object.freeze(ambiguous),
  });
}
