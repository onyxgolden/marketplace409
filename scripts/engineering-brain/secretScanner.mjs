// Requirement 7: detect likely secrets in files the denylist didn't already catch, and fail closed
// -- the caller excludes the record and reports only the *pattern name* that matched, never the
// matched text itself, so a sanitized error can be surfaced without repeating the secret in the very
// report meant to be safe to share.
const SECRET_PATTERNS = Object.freeze([
  { name: "stripe_live_secret_key", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: "stripe_live_restricted_key", pattern: /\brk_live_[A-Za-z0-9]{16,}\b/ },
  { name: "stripe_webhook_secret", pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/ },
  { name: "aws_access_key_id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: "supabase_service_role_jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "generic_private_key_block", pattern: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "plaid_secret_assignment", pattern: /plaid[_-]?secret\s*[:=]\s*["'][A-Za-z0-9]{16,}["']/i },
  {
    name: "high_entropy_secret_assignment",
    // Deliberately narrow: only a *hardcoded literal* assigned to a variable named like a secret --
    // `const apiKey = process.env.API_KEY` must never match, since that's how secrets are supposed
    // to be referenced in source. Requires 24+ chars of literal to avoid flagging short placeholders
    // like "changeme" or "your-key-here".
    pattern: /(secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i,
  },
]);

export function scanForSecrets(content) {
  if (!content) return [];
  const matches = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) matches.push(name);
  }
  return matches;
}

export function containsLikelySecret(content) {
  return scanForSecrets(content).length > 0;
}
