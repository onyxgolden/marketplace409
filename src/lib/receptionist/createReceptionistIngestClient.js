import { createClient } from "@supabase/supabase-js";

// Service-role client for the receptionist ingestion endpoint ONLY.
// Server-side; the key never leaves the server and never reaches the
// voice worker or any browser client. The worker authenticates with an
// HMAC signature instead (see ingestAuth.js).
function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Receptionist ingestion requires ${name}.`);
  return value.trim();
}

export function createReceptionistIngestClient(env = process.env) {
  return createClient(
    required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
