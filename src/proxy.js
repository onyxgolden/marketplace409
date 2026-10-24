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

export async function proxy(request) {
  if (!hasSupabaseAuthCookie(request)) {
    return NextResponse.next({
      request,
    });
  }

  let response = NextResponse.next({
    request,
  });

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

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(
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
        },
      },
    },
  );

  /*
   * Validate and refresh the session before the request
   * reaches authenticated server routes.
   */
  await supabase.auth.getUser();

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
