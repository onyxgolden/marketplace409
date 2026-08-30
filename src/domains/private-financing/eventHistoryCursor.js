// Keyset (not offset) pagination for the seller-facing ledger-history read model. ledger_sequence is a
// stable, gapless, per-account, monotonically-increasing total order (the migration's own
// idx_private_financing_events_account_sequence index and its NOT NULL CHECK(> 0) constraint) -- exactly
// the property keyset pagination needs and offset pagination does not have: a cursor anchored to "every
// event with ledger_sequence strictly greater than N" can never duplicate or skip a row when new events
// are appended between page fetches (append-only, so nothing before the cursor ever shifts), whereas an
// OFFSET-based page is defined by POSITION and silently shifts under exactly that condition.
//
// The cursor is opaque to the caller by convention (never parsed client-side) but not secret -- the data
// it carries (an account id and a ledger sequence number) is not sensitive on its own; RLS is what
// actually protects the underlying rows, not the cursor's obscurity. Embedding the account id inside the
// cursor and requiring it to match the account id in the request URL is what makes cross-account cursor
// reuse a well-defined, rejected error instead of an accidentally-meaningless no-op.

export class InvalidEventHistoryCursorError extends Error {
  constructor(reason) {
    super(`Invalid event history cursor: ${reason}`);
    this.name = "InvalidEventHistoryCursorError";
  }
}

export const DEFAULT_EVENT_HISTORY_PAGE_SIZE = 50;
export const MAX_EVENT_HISTORY_PAGE_SIZE = 200;

export function encodeEventHistoryCursor({ accountId, ledgerSequence }) {
  return Buffer.from(JSON.stringify({ accountId, ledgerSequence }), "utf8").toString("base64url");
}

// Fails closed: any structurally malformed, truncated, non-JSON, wrong-shaped, or cross-account cursor
// throws InvalidEventHistoryCursorError rather than silently falling back to "no cursor" (which would
// silently restart pagination from the beginning -- a correctness bug, not a safe default) or guessing at
// intent.
export function decodeEventHistoryCursor(cursorString, { expectedAccountId }) {
  if (typeof cursorString !== "string" || cursorString.length === 0) {
    throw new InvalidEventHistoryCursorError("cursor must be a non-empty string");
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursorString, "base64url").toString("utf8"));
  } catch {
    throw new InvalidEventHistoryCursorError("cursor is not valid base64url-encoded JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidEventHistoryCursorError("decoded cursor must be an object");
  }
  if (typeof parsed.accountId !== "string" || parsed.accountId.length === 0) {
    throw new InvalidEventHistoryCursorError("cursor is missing a valid accountId");
  }
  if (!Number.isInteger(parsed.ledgerSequence) || parsed.ledgerSequence <= 0 || !Number.isSafeInteger(parsed.ledgerSequence)) {
    throw new InvalidEventHistoryCursorError("cursor is missing a valid ledgerSequence");
  }
  if (parsed.accountId !== expectedAccountId) {
    throw new InvalidEventHistoryCursorError("cursor was issued for a different account");
  }

  return { ledgerSequence: parsed.ledgerSequence };
}

// Clamps an explicit, caller-supplied page size to [1, MAX_EVENT_HISTORY_PAGE_SIZE], defaulting when
// absent/invalid -- unlike the cursor (whose validity affects correctness), a malformed limit only
// affects convenience, so it is safe to clamp rather than reject outright.
export function resolveEventHistoryPageSize(requestedLimit) {
  const parsed = Number(requestedLimit);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_EVENT_HISTORY_PAGE_SIZE;
  return Math.min(parsed, MAX_EVENT_HISTORY_PAGE_SIZE);
}
