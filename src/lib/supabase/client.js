import {
  createBrowserClient,
} from "@supabase/ssr";

let browserClient = null;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  }

  return browserClient;
}
