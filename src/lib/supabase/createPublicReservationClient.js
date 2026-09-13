import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Public reservations require ${name}.`);
  return value.trim();
}

export function createPublicReservationClient(env = process.env) {
  return createClient(
    required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
