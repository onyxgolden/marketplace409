import { createClient } from "@supabase/supabase-js";

// A separate, near-identical copy of createRentalWebhookClient.js's own service-role client
// constructor, rather than importing that one directly -- it's named/scoped for the Rental
// webhook specifically, and reusing it here would couple this domain to that one for a 6-line
// function with zero Rental-specific logic. Deliberately not renaming/relocating the existing
// one either, to avoid any risk to the working Rental Stripe webhook path.
function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Financial Connections webhook requires ${name}.`);
  return value.trim();
}

export function createFinancialConnectionsWebhookClient(env = process.env) {
  return createClient(
    required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
