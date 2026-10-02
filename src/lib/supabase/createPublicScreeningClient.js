import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Public screening link requires ${name}.`);
  return value.trim();
}

// Service-role client for the no-login applicant screening link.
// Every query is scoped to a single screening's random 24-char token; the
// token is never the application id, and guessing it yields a 404.
export function createPublicScreeningClient(env = process.env) {
  return createClient(
    required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
