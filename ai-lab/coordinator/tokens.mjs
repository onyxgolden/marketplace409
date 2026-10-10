// RatificationToken validation (Coordinator v6 contract).
//
// A RatificationToken is a trusted INPUT minted only by the established
// Jason<->Muse instruction channel. The Coordinator records and validates
// tokens; it can never manufacture one by scanning artifact content. A claim
// with no valid token fails closed: provenance "unknown", displayed as
// "authorization provenance unknown".

export const TRUSTED_TOKEN_ISSUER = "jason-muse-channel";
export const AUTHORIZATION_PROVENANCE_UNKNOWN = "authorization provenance unknown";

// Scope coverage is exact, or by explicit prefix: a token scoped "merge"
// covers the claim scope "merge:code-tests". Nothing else implies coverage.
export function scopeCovers(tokenScope, claimScope) {
  if (!tokenScope || !claimScope) return false;
  if (tokenScope === claimScope) return true;
  return claimScope.startsWith(`${tokenScope}:`);
}

// Validate one token against one claim at one evaluation instant.
// claim: { scope, task_id, code_head_sha }
// Returns { valid, reasons } -- every failed check is named, never generic.
export function validateRatificationToken(token, claim, now) {
  const reasons = [];
  if (!token) {
    return { valid: false, reasons: ["no ratification token present in the trusted channel store"] };
  }
  if (token.issuer !== TRUSTED_TOKEN_ISSUER) {
    reasons.push(`untrusted token issuer: ${token.issuer ?? "missing"}`);
  }
  if (token.principal !== "jason") {
    reasons.push(`token principal is ${token.principal ?? "missing"}, not jason`);
  }
  if (!scopeCovers(token.scope, claim.scope)) {
    reasons.push(`token scope "${token.scope ?? "missing"}" does not cover claim scope "${claim.scope}"`);
  }
  if (token.task_id != null && token.task_id !== claim.task_id) {
    reasons.push(`token is bound to task ${token.task_id}, not ${claim.task_id}`);
  }
  if (token.code_head_sha != null && claim.code_head_sha != null && token.code_head_sha !== claim.code_head_sha) {
    reasons.push(`token is bound to code head ${token.code_head_sha}, not ${claim.code_head_sha}`);
  }
  const nowMs = Date.parse(now);
  const issuedMs = Date.parse(token.issued_at);
  const expiresMs = Date.parse(token.expires_at);
  if (Number.isNaN(nowMs)) {
    reasons.push("evaluation time is missing or unparseable; token validity cannot be established");
  }
  if (Number.isNaN(issuedMs) || Number.isNaN(expiresMs)) {
    reasons.push("token issued_at/expires_at missing or unparseable");
  } else if (!Number.isNaN(nowMs)) {
    if (nowMs < issuedMs) reasons.push("token is not yet valid at evaluation time (issued_at is in the future)");
    if (nowMs >= expiresMs) reasons.push("token expired at evaluation time");
  }
  if (token.revoked === true) {
    reasons.push("token has been revoked");
  }
  return { valid: reasons.length === 0, reasons };
}
