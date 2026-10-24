import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
} from "next/server";

/*
 * S3 (performance audit): one auth check per request.
 *
 * Two changes, both confined to this proxy:
 *
 * 1. The matcher (below) scopes the proxy to the authenticated
 *    sections of the app. Public/content sections (e.g.
 *    /privacy, /terms, /market, /listing, /post) and any
 *    unmatched path no longer invoke the proxy at all, so they
 *    pay no session validation. Every section that requires
 *    authentication, or resolves identity server-side, stays
 *    matched and keeps the exact session-refresh behavior in
 *    the body below. Mixed public/private sections (e.g.
 *    /investors) stay matched in full on purpose.
 *
 * 2. A request that presents no Supabase auth cookie has no
 *    session to validate or refresh. With no stored session,
 *    supabase.auth.getUser() reads the (empty) cookie storage,
 *    returns AuthSessionMissingError, and performs no network
 *    call and no cookie write (verified against
 *    @supabase/auth-js __loadSession / _getUser). Returning
 *    the passthrough response immediately is therefore
 *    behavior-identical for anonymous requests, and it removes
 *    the validation cost from anonymous traffic on matched
 *    routes too (including would-be 404s under /api).
 *    Any cookie whose name marks it as session material
 *    (auth-token, its chunked .0/.1 parts, or the PKCE
 *    code-verifier, which shares the -auth-token prefix)
 *    takes the full path below, exactly as before.
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
     * Authenticated sections only. "/" is the workspace hub:
     * it resolves identity server-side (loadWorkspaceHub) and
     * renders workspace data keyed to the signed-in user, so
     * it keeps the session-refresh path.
     */
    "/",
    "/api/:path*",
    "/forge/:path*",
    "/admin/:path*",
    "/auth/:path*",
    "/investors/:path*",
    "/businesses/add",
    "/businesses/edit/:path*",
    "/businesses/:id/claim",
    "/edit/:path*",
    "/jobs/add",
    "/jobs/edit/:path*",
    "/pets/add",
    "/pets/edit/:path*",
    "/financial-snapshot",
    "/import",
    "/my-listings",
    "/saved-listings",
  ],
};
