// FORGE Capture Rung 5 — public client configuration.
//
// The desktop app is a compiled binary: it cannot read the web app's
// NEXT_PUBLIC_ build-time values. The Supabase URL and publishable (anon)
// key are public by design — they ship inside every browser bundle — so
// serving them from this endpoint is no broader an exposure than the web
// app itself. The desktop "Connect FORGE account" dialog fetches them here
// before performing the email/password exchange directly against Supabase
// Auth; the password never touches FORGE servers.
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Capture upload is not configured." }, { status: 500 });
  }
  return NextResponse.json({ supabaseUrl, supabaseAnonKey });
}
