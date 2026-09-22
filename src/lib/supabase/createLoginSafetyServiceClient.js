import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Login safety service client requires ${name}.`);
  return value.trim();
}

// Service-role client for the login-safety server routes. location_action_tokens
// has RLS enabled with no permissive policies, so only the service role can
// read/write it. The user identity still comes exclusively from the verified
// session in each route -- this client is never a substitute for auth.
export function createLoginSafetyServiceClient(env = process.env) {
  return createClient(required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } });
}
