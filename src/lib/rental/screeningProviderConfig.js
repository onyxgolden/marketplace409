// Centralized, server-only resolution of the external tenant-screening destination.
// The redirect route is the only place that reads this — UI components never see a raw URL,
// only the resolved `affiliateActive` flag, so the destination can change without touching the UI.

const SMARTMOVE_DEFAULT_URL = "https://www.mysmartmove.com/";

// Hosts the hardcoded fallback is allowed to resolve to. Guards the constant above.
const SMARTMOVE_ALLOWED_FALLBACK_HOSTS = Object.freeze([
  "mysmartmove.com",
  "www.mysmartmove.com",
  "transunion.com",
  "www.transunion.com",
]);

// Hosts a configured affiliate URL is allowed to resolve to. Deliberately empty: no approved
// affiliate/tracking domain exists yet, and an environment variable must never be able to turn
// on affiliate mode by itself. Activating it requires a code change adding the real, approved
// host here once TransUnion (or an approved affiliate network) issues one — never guess it.
const SMARTMOVE_AFFILIATE_HOST_ALLOWLIST = Object.freeze([]);

function normalizedHost(hostname) {
  return String(hostname || "").trim().toLowerCase();
}

// Exact match only — never a suffix/`endsWith` check — so a hostname like
// "mysmartmove.com.attacker.example" can never pass as "mysmartmove.com".
export function isAllowedSmartMoveFallbackHost(hostname) {
  return SMARTMOVE_ALLOWED_FALLBACK_HOSTS.includes(normalizedHost(hostname));
}
export function isApprovedSmartMoveAffiliateHost(hostname, allowlist = SMARTMOVE_AFFILIATE_HOST_ALLOWLIST) {
  const host = normalizedHost(hostname);
  return allowlist.some((allowed) => normalizedHost(allowed) === host);
}

function parseApprovedAffiliateUrl(value, allowlist) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null; // never accept credentials in the URL
  if (!isApprovedSmartMoveAffiliateHost(url.hostname, allowlist)) return null;
  return url;
}

// Single centralized config value. Unset/blank, or set to anything that isn't an approved,
// credential-free https URL on the (currently empty) affiliate allowlist: the official
// non-affiliate SmartMove URL is used and no commission is claimed. Only a value that clears
// every check activates affiliate mode. Never sourced from a request.
// `affiliateAllowlist` is only ever overridden in tests — production always uses the real,
// empty default above.
export function resolveSmartMoveDestination(env = process.env, affiliateAllowlist = SMARTMOVE_AFFILIATE_HOST_ALLOWLIST) {
  const raw = env.RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL;
  if (raw && raw.trim()) {
    const approved = parseApprovedAffiliateUrl(raw, affiliateAllowlist);
    if (approved) return Object.freeze({ url: approved.toString(), affiliateActive: true, configuredValueRejected: false });
    return Object.freeze({ url: SMARTMOVE_DEFAULT_URL, affiliateActive: false, configuredValueRejected: true });
  }
  return Object.freeze({ url: SMARTMOVE_DEFAULT_URL, affiliateActive: false, configuredValueRejected: false });
}

export const SMARTMOVE_DEFAULT_SCREENING_URL = SMARTMOVE_DEFAULT_URL;
