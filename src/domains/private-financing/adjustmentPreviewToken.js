// Binds a computed adjustment preview to the exact account, action, inputs, and ledger state it was
// computed against, so the confirm endpoint can detect staleness (a new event posted since preview),
// tampering (inputs changed client-side), and cross-account reuse before ever calling the guarded RPC.
//
// This token is opaque by convention but carries no capability -- it is not a security boundary. The real
// security boundary is append_private_financing_event() itself (SECURITY DEFINER, has_workspace_access,
// server-forced attribution), which never trusts anything this token claims. The confirm route always
// independently re-fetches the CURRENT max ledger sequence and re-runs the SAME preview computation fresh
// before ever deciding to post -- this token only lets that route detect "did the seller's screen go
// stale" without a client round-trip carrying the seller's original inputs a second, separately-editable
// time.

export class InvalidAdjustmentPreviewTokenError extends Error {
  constructor(reason) {
    super(`Invalid adjustment preview token: ${reason}`);
    this.name = "InvalidAdjustmentPreviewTokenError";
  }
}

export function encodeAdjustmentPreviewToken({ accountId, actionType, inputs, ledgerSequenceAtPreview, asOfDate }) {
  return Buffer.from(JSON.stringify({ accountId, actionType, inputs, ledgerSequenceAtPreview, asOfDate }), "utf8").toString("base64url");
}

// Fails closed on any structurally malformed token. Does NOT compare against expected values itself --
// see assertAdjustmentPreviewTokenFresh for the staleness/mismatch checks a caller runs against live data.
export function decodeAdjustmentPreviewToken(tokenString) {
  if (typeof tokenString !== "string" || tokenString.length === 0) {
    throw new InvalidAdjustmentPreviewTokenError("token must be a non-empty string");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(tokenString, "base64url").toString("utf8"));
  } catch {
    throw new InvalidAdjustmentPreviewTokenError("token is not valid base64url-encoded JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new InvalidAdjustmentPreviewTokenError("decoded token must be an object");
  if (typeof parsed.accountId !== "string" || parsed.accountId.length === 0) throw new InvalidAdjustmentPreviewTokenError("token is missing a valid accountId");
  if (typeof parsed.actionType !== "string" || parsed.actionType.length === 0) throw new InvalidAdjustmentPreviewTokenError("token is missing a valid actionType");
  if (typeof parsed.inputs !== "object" || parsed.inputs === null) throw new InvalidAdjustmentPreviewTokenError("token is missing valid inputs");
  if (!Number.isInteger(parsed.ledgerSequenceAtPreview) || parsed.ledgerSequenceAtPreview < -1) throw new InvalidAdjustmentPreviewTokenError("token is missing a valid ledgerSequenceAtPreview");
  if (typeof parsed.asOfDate !== "string" || parsed.asOfDate.length === 0) throw new InvalidAdjustmentPreviewTokenError("token is missing a valid asOfDate");
  return parsed;
}

export class StaleAdjustmentPreviewError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "StaleAdjustmentPreviewError";
  }
}

// Deep-equal via JSON serialization -- `inputs` is always a plain, JSON-round-tripped object (it came
// from a decoded token and a parsed request body on the two sides being compared), so this is safe and
// avoids pulling in a deep-equal dependency for a same-shape comparison.
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Throws StaleAdjustmentPreviewError (never silently proceeds) if the decoded token no longer matches the
// live request: a different account (cross-account reuse), a different action or inputs (tampering or a
// genuinely different request reusing an old token), or a ledger sequence that has moved (a new event
// posted since the preview was computed -- the seller's screen is now stale and must be refreshed).
export function assertAdjustmentPreviewTokenFresh(decodedToken, { accountId, actionType, inputs, currentLedgerSequence }) {
  if (decodedToken.accountId !== accountId) throw new StaleAdjustmentPreviewError("This preview was issued for a different account.");
  if (decodedToken.actionType !== actionType) throw new StaleAdjustmentPreviewError("This preview was issued for a different action.");
  if (!deepEqual(decodedToken.inputs, inputs)) throw new StaleAdjustmentPreviewError("The adjustment details have changed since this preview was computed.");
  if (decodedToken.ledgerSequenceAtPreview !== currentLedgerSequence) {
    throw new StaleAdjustmentPreviewError("The ledger has changed since this preview was computed. Please refresh and try again.");
  }
}
