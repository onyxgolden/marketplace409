// Strict denylist (requirement 6). Every excluded path gets a reason code so the sanitized report
// can show *why* something was left out without ever needing to show *what* it was.
//
// This only needs to reason about paths git already tracks -- .env files, node_modules, and build
// output are already gitignored in this repo and never reach listTrackedFiles() at all. The patterns
// below are defense in depth for the day someone accidentally commits one of these anyway, plus the
// categories (uploads, provider payloads, PII exports) that have no natural home in a Next.js repo
// but are excluded proactively per requirement 6.
const DENYLIST_RULES = Object.freeze([
  { reason: "env_file", test: (path) => /(^|\/)\.env(\.|$)/.test(path) },
  { reason: "secret_or_key_file", test: (path) => /\.(pem|key|p12|pfx)$/i.test(path) || /(^|\/)(id_rsa|id_ed25519)(\.|$)/.test(path) },
  { reason: "credentials_file", test: (path) => /(^|\/)credentials(\.[a-z0-9]+)?$/i.test(path) || /service[-_]?account.*\.json$/i.test(path) },
  { reason: "dependency", test: (path) => /(^|\/)node_modules\//.test(path) },
  { reason: "build_output", test: (path) => /(^|\/)(\.next|dist|build|out|coverage)\//.test(path) },
  { reason: "temp_file", test: (path) => /(^|\/)\.tmp\// .test(path) || /\.(tmp|swp|swo)$/.test(path) || /(^|\/)tmp\//.test(path) },
  { reason: "uploaded_private_document", test: (path) => /(^|\/)(uploads|private-documents|user-uploads)\//i.test(path) },
  { reason: "raw_provider_payload", test: (path) => /(^|\/)(provider-payloads|raw-webhooks|stripe-events|plaid-payloads)\//i.test(path) },
  { reason: "tenant_pii_export", test: (path) => /(^|\/)(exports|data-exports|tenant-exports)\//i.test(path) || /\.dump$/i.test(path) },
  { reason: "lockfile", test: (path) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path) },
]);

export function classifyDenylist(path) {
  for (const rule of DENYLIST_RULES) {
    if (rule.test(path)) return rule.reason;
  }
  return null;
}

export function isDenylisted(path) {
  return classifyDenylist(path) !== null;
}

export const DENYLIST_REASONS = Object.freeze(DENYLIST_RULES.map((rule) => rule.reason));
