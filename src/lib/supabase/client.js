import {
  createBrowserClient,
} from "@supabase/ssr";

let browserClient = null;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  }

  return browserClient;
}

// TODO(layer2-refresh): silent token refresh coordination.
//
// The gateway route EXISTS (POST /api/auth/refresh { operationId,
// refresh_token } -> { status:'ok', session } | 401/429/503 { error }), but
// the browser client below still lets the Supabase SDK refresh directly.
// When ACTIVATION_CONFIG.enabled is true, silent refresh must go through the
// gateway instead: the client sends its refresh_token, applies the returned
// session via setSession, and elects a SINGLE refresh leader per session
// family across tabs (the gateway does one provider refresh per request;
// the provider's rotation invalidates the old refresh token on use, so two
// tabs racing the same token will lose one race — bounded retries, provider
// replay protections preserved).
//
// Wiring sketch (not yet implemented — needs a refresh lock around the SDK's
// automatic refresh, which is delicate):
//   1. Intercept the SDK's refresh (custom fetch wrapper or a mutex around
//      getSession/refresh calls).
//   2. POST /api/auth/refresh with { operationId, refresh_token }.
//   3. On { status:'ok', session }: supabase.auth.setSession(session).
//   4. On 429: honor Retry-After; on 503/401: surface "session refresh
//      failed, please sign in again" — never silently sign out.
// Until this is wired and reviewed, the SDK's built-in refresh behavior above
// is UNCHANGED. No secret keys may ever enter this browser client — the
// service-role key stays in serverAuthTransport.js (server-only).
