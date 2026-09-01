// Host classification for FB-UI-1's "operate against local or Vercel Preview URLs only" requirement.
// Deny-by-default: a host is only ever "local" or "preview" if it positively matches one of the
// rules below. Anything else -- including this repo's own known production hostnames, and any
// hostname this classifier doesn't recognize at all -- classifies as "denied". A denylist alone
// would be the wrong shape here (an unanticipated hostname would default to "allowed"); an allowlist
// with an explicit production denylist checked FIRST is fail-closed against a production hostname
// that also happens to match the generic *.vercel.app preview pattern (this repo's own production
// domain is a vercel.app subdomain, aliased -- see PRODUCTION_HOSTS below).

const PRODUCTION_HOSTS = Object.freeze(["marketplace409.vercel.app"]);

const LOCAL_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

// Vercel preview deployments: <project>-<hash>-<team>.vercel.app. Deliberately requires at least
// two hyphen-separated segments before ".vercel.app" (a bare "<project>.vercel.app" -- the alias
// shape production itself uses -- must NOT match this rule; production is excluded by the earlier
// PRODUCTION_HOSTS check regardless, but this keeps the preview rule itself honest about what a
// real preview subdomain actually looks like).
const PREVIEW_HOST_PATTERN = /^[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/i;

export class HostNotPermittedError extends Error {
  constructor(host, reasonCode) {
    super(`Host "${host}" is not permitted for screenshot evidence capture: ${reasonCode}`);
    this.name = "HostNotPermittedError";
    this.host = host;
    this.reasonCode = reasonCode;
  }
}

export function classifyHost(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return Object.freeze({ host: rawUrl, classification: "denied", reasonCode: "unparseable_url" });
  }

  if (PRODUCTION_HOSTS.includes(host)) {
    return Object.freeze({ host, classification: "denied", reasonCode: "production_host" });
  }
  if (LOCAL_HOSTS.includes(host)) {
    return Object.freeze({ host, classification: "local", reasonCode: "local_host" });
  }
  if (PREVIEW_HOST_PATTERN.test(host)) {
    return Object.freeze({ host, classification: "preview", reasonCode: "vercel_preview_host" });
  }
  return Object.freeze({ host, classification: "denied", reasonCode: "unrecognized_host" });
}

// Throws (fail-closed) rather than returning a boolean -- a caller that forgets to check a boolean
// return value is a real class of bug this avoids structurally; capture code is expected to call
// this and let it throw before ever launching a browser against the URL.
export function assertHostPermitted(rawUrl) {
  const result = classifyHost(rawUrl);
  if (result.classification === "denied") throw new HostNotPermittedError(result.host, result.reasonCode);
  return result;
}
