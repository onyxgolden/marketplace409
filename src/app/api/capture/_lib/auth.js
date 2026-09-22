// FORGE Capture Rung 5 — request guard for the capture-library API.
//
// The desktop app is a non-browser client: it sends the user's Supabase
// access token as `Authorization: Bearer <token>` (the token lives in the
// OS credential store, never in a file). The shared
// createAuthenticatedForgeApplication helper is cookie-based (@supabase/ssr)
// and cannot see that header, so this guard handles the Bearer path first
// and falls back to the cookie path for browser callers.
//
// Either way the owner is derived from the validated session — never from
// client-supplied owner_id, workspace_id, or storage_path.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match ? match[1].trim() : "";
  return token || null;
}

export async function guardCaptureRequest(request) {
  const token = bearerToken(request);
  if (token) {
    // Validate the JWT against the Auth server; getUser(jwt) does not trust
    // the token's claims without verification.
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user?.id) {
      return {
        response: NextResponse.json({ error: "Invalid or expired session. Sign in to FORGE again." }, { status: 401 }),
      };
    }
    return { user: data.user, supabaseClient };
  }

  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return { response: authenticated.response };
  return { user: authenticated.user, supabaseClient: authenticated.supabaseClient };
}
