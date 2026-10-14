import {
  createBrowserClient,
} from "@supabase/ssr";

import { gatewayRefresh, newOperationId } from "@/lib/auth/authGateway.js";

let browserClient = null;

// Layer 2: route the SDK's silent token refresh through the gateway.
//
// Disabled by default: NEXT_PUBLIC_LAYER2_GATEWAY_REFRESH must be "true".
// When disabled, the SDK refreshes directly against Supabase (existing
// behavior, unchanged).
//
// When enabled, the browser client's fetch is wrapped: token-endpoint calls
// with grant_type=refresh_token are diverted to POST /api/auth/refresh,
// which admission-gates the refresh (IP + per-credential buckets) and performs the
// single provider refresh per request. The gateway's { status:'ok', session }
// is translated into the token endpoint's response shape so the SDK's
// session handling (including cookie persistence via @supabase/ssr) works
// unchanged. A gateway refusal PRESERVES its status and Retry-After: 429/503
// are retryable (the SDK backs off and keeps the session); only 401 means
// the credential is dead. Mapping refusals to 401 would drop sessions a
// backoff would have saved and desync cookie rotation.
//
// MULTI-TAB: the gateway performs exactly one provider refresh per request
// and the provider's rotation invalidates the old refresh token on use, so
// two tabs racing the same token will lose one race. The losing tab's SDK
// sees a 401 refresh, drops its local session, and re-reads the fresh
// session from the shared cookie storage on the next getSession — the
// provider's replay protections apply; this wrapper adds no extra rotation.
// No secret keys ever enter this browser client.
const GATEWAY_REFRESH_ENABLED = process.env.NEXT_PUBLIC_LAYER2_GATEWAY_REFRESH === "true";

function isRefreshTokenRequest(input) {
  try {
    const url = typeof input === "string" ? input : input?.url;
    return (
      typeof url === "string" &&
      url.includes("/auth/v1/token") &&
      url.includes("grant_type=refresh_token")
    );
  } catch {
    return false;
  }
}

function jsonResponse(payload, status, extraHeaders = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

async function gatewayRefreshFetch(input, init) {
  if (GATEWAY_REFRESH_ENABLED && isRefreshTokenRequest(input)) {
    let refreshToken = null;
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : null;
    } catch {
      refreshToken = null;
    }
    if (refreshToken) {
      try {
        const result = await gatewayRefresh({ operationId: newOperationId(), refreshToken });
        if (result?.status === "ok" && result.session?.access_token) {
          const s = result.session;
          return jsonResponse(
            {
              access_token: s.access_token,
              refresh_token: s.refresh_token,
              expires_in: s.expires_in ?? 3600,
              expires_at: s.expires_at,
              token_type: "bearer",
              user: s.user ?? null,
            },
            200
          );
        }
        // L2-008: preserve the gateway's refusal status and Retry-After.
        // 429 (admission/backoff or the in-flight execution lease) and 503
        // (unavailable) are RETRYABLE — the SDK must back off, not drop the
        // session. Only 401 means the credential is dead. Mapping every
        // refusal to 401 would make the SDK discard sessions a short
        // backoff would have saved, and would desync cookie rotation.
        const status =
          typeof result?.httpStatus === "number" && result.httpStatus >= 400
            ? result.httpStatus
            : 503;
        const retryHeaders =
          typeof result?.retryAfterSeconds === "number" && result.retryAfterSeconds >= 0
            ? { "retry-after": String(Math.ceil(result.retryAfterSeconds)) }
            : null;
        return jsonResponse({ error: "session refresh failed" }, status, retryHeaders);
      } catch {
        // Transport failure reaching the gateway: 503 (retryable). Never
        // silently retry direct against the provider — that would bypass
        // admission.
        return jsonResponse({ error: "session refresh failed" }, 503);
      }
    }
  }
  return fetch(input, init);
}

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      GATEWAY_REFRESH_ENABLED ? { global: { fetch: gatewayRefreshFetch } } : undefined
    );
  }

  return browserClient;
}

// Test seam: whether gateway-routed refresh is enabled.
export function isGatewayRefreshEnabled() {
  return GATEWAY_REFRESH_ENABLED;
}

// Test seam: the wrapped fetch, for L2-008(d) tests.
export function gatewayRefreshFetchForTest() {
  return gatewayRefreshFetch;
}
