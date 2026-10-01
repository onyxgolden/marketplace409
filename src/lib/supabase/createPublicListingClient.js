import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Public rental listings require ${name}.`);
  return value.trim();
}

// Service-role client for the no-login public listing/application surface.
// Every query is scoped to a single published listing's public_slug; the
// slug is a random 12-char token, never the internal unit id.
export function createPublicListingClient(env = process.env) {
  return createClient(
    required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
