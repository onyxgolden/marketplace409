// Fail-closed bounded HTTP harness for the Property Risk Radar R0
// preflight CLI. Node 24 built-ins only.
//
// The harness never decides rights: an HTTP 200 is not permission. It only
// enforces the network boundary (allowlisted HTTPS hosts/paths, redirect
// cap, timeout, body cap, one concurrent request per host, one bounded
// retry) and returns the raw response for the adapter to validate.
//
// Live preflight runs only under Jason's separate authorization, passed
// as an explicit --authorization reference to `preflight --live` (see
// src/livePreflight.mjs). The runner refuses to run without one, and live
// output goes only to a caller-supplied directory for review before any
// fixture is committed. Tests exercise this module with an injected fake
// fetch; no live call is made without that authorization.

export const MAX_REDIRECTS = 2;
export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_RETRY_AFTER_SECONDS = 30;
export const NWS_USER_AGENT =
  "FORGE-Risk-Radar-R0 (https://409marketplace.online/property-risk-radar/sources)";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function errorWithCode(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const seconds = Number.parseInt(String(value).trim(), 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  }
  const date = Date.parse(String(value).trim());
  if (Number.isFinite(date)) {
    return Math.max(
      0,
      Math.min(
        Math.floor((date - Date.now()) / 1000),
        MAX_RETRY_AFTER_SECONDS,
      ),
    );
  }
  return 0;
}

// Secret-like patterns that must never appear in a fixture, a log line, or a
// committed file. Scanned by validateRegistry/fixture tests; redacted from
// any diagnostic string by redactSecrets().
const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*[^\s"'&]+/i,
  /apikey\s*[:=]\s*[^\s"'&]+/i,
  /\btoken\s*[:=]\s*[^\s"'&]+/i,
  /access[_-]?token\s*[:=]\s*[^\s"'&]+/i,
  /auth[_-]?token\s*[:=]\s*[^\s"'&]+/i,
  /authorization\s*:\s*[^\r\n]+/i,
  /bearer\s+[A-Za-z0-9._\-~+/=]+/i,
  /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /client[_-]?secret\s*[:=]\s*[^\s"'&]+/i,
];

export function redactSecrets(text) {
  let redacted = String(text);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

// Returns the first secret-like match in `text`, or null. Walks JSON values
// when given an object.
export function findSecretLike(value, label = "value") {
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.exec(value);
      if (match) {
        return `${label}: secret-like content matching ${pattern}`;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretLike(value[index], `${label}[${index}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const found = findSecretLike(entry, `${label}.${key}`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return null;
}

// Create a bounded fetch. `fetchImpl` defaults to the global fetch and is
// injected by tests so no real network is ever touched offline.
// Options: allowHosts (exact hostnames), allowPathPrefixes (strings the
// pathname must start with), userAgent, timeoutMs.
export function createBoundedFetch(options) {
  const {
    fetchImpl = globalThis.fetch,
    allowHosts,
    allowPathPrefixes,
    userAgent = NWS_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!Array.isArray(allowHosts) || allowHosts.length === 0) {
    throw errorWithCode(
      "BAD_HARNESS_CONFIG",
      "bounded fetch requires a non-empty allowHosts list",
    );
  }
  if (!Array.isArray(allowPathPrefixes) || allowPathPrefixes.length === 0) {
    throw errorWithCode(
      "BAD_HARNESS_CONFIG",
      "bounded fetch requires a non-empty allowPathPrefixes list",
    );
  }

  // One concurrent request per host, enforced by a per-host promise chain.
  const hostQueues = new Map();

  function checkUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw errorWithCode("BAD_URL", `not a valid URL: ${redactSecrets(rawUrl)}`);
    }
    if (url.protocol !== "https:") {
      throw errorWithCode(
        "NOT_HTTPS",
        `refused non-HTTPS URL: ${url.protocol}//${url.host}`,
      );
    }
    if (!allowHosts.includes(url.hostname)) {
      throw errorWithCode(
        "HOST_NOT_ALLOWLISTED",
        `refused host outside allowlist: ${url.hostname}`,
      );
    }
    if (!allowPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      throw errorWithCode(
        "PATH_NOT_ALLOWED",
        `refused path outside allowlist: ${url.pathname}`,
      );
    }
    return url;
  }

  async function readBodyCapped(response) {
    if (!response.body) {
      return { text: "", bytes: 0 };
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number.parseInt(contentLength, 10);
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
        throw errorWithCode(
          "BODY_TOO_LARGE",
          `content-length ${length} exceeds ${MAX_BODY_BYTES} byte cap`,
        );
      }
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Reader already closed; the cap error is what matters.
        }
        throw errorWithCode(
          "BODY_TOO_LARGE",
          `body exceeds ${MAX_BODY_BYTES} byte cap`,
        );
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    return { text: body.toString("utf8"), bytes: total };
  }

  async function doFetch(url, headers) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted || error?.name === "TimeoutError") {
        throw errorWithCode(
          "TIMEOUT",
          `request timed out after ${timeoutMs}ms: ${url.hostname}${url.pathname}`,
        );
      }
      throw error;
    }

    let redirects = 0;
    while (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        break;
      }
      redirects += 1;
      if (redirects > MAX_REDIRECTS) {
        throw errorWithCode(
          "TOO_MANY_REDIRECTS",
          `redirect chain exceeded ${MAX_REDIRECTS} hops at ${url.hostname}${url.pathname}`,
        );
      }
      const next = new URL(location, url);
      checkUrl(next.toString());
      url = next;
      const nextSignal = AbortSignal.timeout(timeoutMs);
      try {
        response = await fetchImpl(url.toString(), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: nextSignal,
        });
      } catch (error) {
        if (nextSignal.aborted || error?.name === "TimeoutError") {
          throw errorWithCode(
            "TIMEOUT",
            `redirect request timed out after ${timeoutMs}ms: ${url.hostname}${url.pathname}`,
          );
        }
        throw error;
      }
    }

    // At most one retry on 429/5xx, honoring Retry-After (capped).
    let attempts = 0;
    while (
      (response.status === 429 || response.status >= 500) &&
      attempts < 1
    ) {
      attempts += 1;
      const waitSeconds = parseRetryAfterSeconds(
        response.headers.get("retry-after"),
      );
      if (waitSeconds > 0) {
        await sleep(waitSeconds * 1000);
      }
      const retrySignal = AbortSignal.timeout(timeoutMs);
      try {
        response = await fetchImpl(url.toString(), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: retrySignal,
        });
      } catch (error) {
        if (retrySignal.aborted || error?.name === "TimeoutError") {
          throw errorWithCode(
            "TIMEOUT",
            `retry request timed out after ${timeoutMs}ms: ${url.hostname}${url.pathname}`,
          );
        }
        throw error;
      }
    }

    const { text, bytes } = await readBodyCapped(response);
    const responseHeaders = {};
    response.headers.forEach((headerValue, headerName) => {
      responseHeaders[headerName.toLowerCase()] = headerValue;
    });
    return {
      url: url.toString(),
      status: response.status,
      headers: responseHeaders,
      bodyText: text,
      bodyBytes: bytes,
      redirects,
      retries: attempts,
    };
  }

  async function boundedFetch(rawUrl) {
    const url = checkUrl(rawUrl);
    const headers = {
      Accept: "application/geo+json, application/json",
      "User-Agent": userAgent,
    };
    const prior = hostQueues.get(url.hostname) || Promise.resolve();
    const run = prior.then(() => doFetch(url, headers));
    // The queue must keep moving even when a request fails.
    hostQueues.set(
      url.hostname,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return boundedFetch;
}
