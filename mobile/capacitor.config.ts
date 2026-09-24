import type { CapacitorConfig } from "@capacitor/cli";

// Call Shield Android companion shell (Slice A).
//
// The WebView loads the FORGE web app; native code exists only for what the
// browser can never do (READ_CALL_LOG). Web content URL is configurable:
//   CALL_SHIELD_WEB_URL=https://your-prod-host npm run sync
// defaults to the production site. Dev: point it at your local dev server.
//
// NOTE: default to the canonical www host. The bare domain 307-redirects to
// www, and the Capacitor WebView does not render after a cross-host redirect
// on the initial load (black screen). allowNavigation covers both hosts so
// in-app bounces between them stay inside the WebView.
const webUrl = process.env.CALL_SHIELD_WEB_URL || "https://www.409marketplace.online";

const config: CapacitorConfig = {
  appId: "online.marketplace409.forge",
  appName: "FORGE Call Shield",
  webDir: "www",
  server: {
    url: webUrl,
    cleartext: webUrl.startsWith("http://"),
    allowNavigation: ["409marketplace.online", "www.409marketplace.online"],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
