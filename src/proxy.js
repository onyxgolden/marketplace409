import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
} from "next/server";

/*
 * S3 (performance audit): one auth check per request.
 *
 * A request that presents no Supabase auth cookie has no
 * session to validate or refresh. With no stored session,
 * supabase.auth.getUser() reads the (empty) cookie storage,
 * returns AuthSessionMissingError, and performs no network
 * call and no cookie write (verified against
 * @supabase/auth-js __loadSession / _getUser). Returning
 * the passthrough response immediately is therefore
 * behavior-identical for anonymous requests, and it removes
 * the validation cost the audit measured: a network
 * getUser() on every non-static path, including anonymous
 * hits and would-be 404s. Any cookie whose name marks it
 * as session material (auth-token, its chunked .0/.1 parts,
 * or the PKCE code-verifier, which shares the -auth-token
 * prefix) takes the full path below, exactly as before.
 *
 * The matcher keeps the original all-routes coverage on
 * purpose. An earlier revision of this slice scoped the
 * matcher to authenticated sections only; that was wrong
 * (review finding P671-001): the shared RootLayout reads
 * the session via getSession() on EVERY page, and
 * getSession() can refresh an expired session. A refresh
 * attempted in a Server Component cannot persist its
 * rotated cookies — the SSR adapter's cookie writes are
 * swallowed there — so the browser kept stale credentials
 * while the server held rotated ones. Every page request
 * therefore stays matched, so any refresh happens here,
 * in middleware, where cookie writes persist to both the
 * forwarded request and the response, before the layout
 * reads the session. The anonymous shortcut above is what
 * keeps this coverage from re-imposing the audit's cost.
 */
function hasSupabaseAuthCookie(request) {
  return request.cookies
    .getAll()
    .some(
      ({ name }) =>
        name.startsWith("sb-") && name.includes("-auth-token"),
    );
}

/*
 * S1 (load-times slice 1): one auth check per request.
 *
 * The proxy validates (and refreshes) the session with
 * supabase.auth.getUser() before the request reaches server code. The
 * factory used to repeat that same network call in every page and API
 * route. The proxy now carries the validated user down in a request
 * header instead, and the factory reads it rather than calling getUser()
 * again. The auth decision is unchanged — the same server-side
 * validation ran, once, here.
 *
 * Trust boundary: this header is only ever trusted because the proxy
 * strips any client-supplied value first (below) and sets it only after
 * getUser() succeeds. A request that reaches server code without the
 * header (no session cookie, failed validation, or a context where the
 * proxy did not run) is treated exactly as before — the factory falls
 * back to getUser().
 */
const FORGE_AUTH_USER_HEADER = "x-forge-auth-user";

export async function proxy(request) {
  // Strip any client-supplied value before anything else trusts it.
  // The override below is built from the live headers, so the strip is
  // enforced downstream even on the anonymous path.
  request.headers.delete(FORGE_AUTH_USER_HEADER);

  if (!hasSupabaseAuthCookie(request)) {
    return NextResponse.next({
      request: { headers: new Headers(request.headers) },
    });
  }

  // Cookies a session refresh writes during getUser(). They are applied
  // to the single response built below, after validation, so a refresh
  // and the validated-user header both survive in one response.
  const refreshedCookies = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(
            ({
              name,
              value,
            }) => {
              request.cookies.set(
                name,
                value,
              );
            },
          );

          refreshedCookies.push(...cookiesToSet);
        },
      },
    },
  );

  /*
   * Validate and refresh the session before the request
   * reaches authenticated server routes.
   *
   * Fail closed: the validated-user header is set only when
   * getUser() reports success — a null error AND a non-empty
   * user id. A user returned alongside a non-null error is
   * not trusted: the header is omitted and the factory falls
   * back to its own getUser() check.
   */
  const {
    data: {
      user,
    },
    error: authError,
  } = await supabase.auth.getUser();

  if (
    authError === null &&
    typeof user?.id === "string" &&
    user.id !== ""
  ) {
    request.headers.set(
      FORGE_AUTH_USER_HEADER,
      JSON.stringify({
        id: user.id,
        email: user.email ?? null,
      }),
    );
  }

  // Build the header override AFTER getUser: a refresh during getUser
  // mutates request.cookies (backed by the live cookie header), so
  // cloning now carries the refreshed cookies as well as the
  // validated-user header. Passing the live request object itself does
  // NOT serialize mutated headers — the explicit override is required.
  const response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });

  refreshedCookies.forEach(
    ({
      name,
      value,
      options,
    }) => {
      response.cookies.set(
        name,
        value,
        options,
      );
    },
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Every request that can render a page stays matched:
     * the shared RootLayout reads SSR session state on all
     * of them, so each one needs this writable refresh
     * boundary in front of it (P671-001). Only requests
     * that never render the layout are excluded — Next
     * static assets, the image optimizer, the favicon and
     * image files. Anonymous requests on matched routes
     * still skip validation entirely via the no-cookie
     * shortcut in the body above.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
