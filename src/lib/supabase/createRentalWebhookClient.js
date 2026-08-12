import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Rental webhook requires ${name}.`);
  return value.trim();
}

export function createRentalWebhookClient(env = process.env) {
  return createClient(required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } });
}
