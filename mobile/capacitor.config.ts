import type { CapacitorConfig } from "@capacitor/cli";

// Call Shield Android companion shell (Slice A).
//
// The WebView loads the FORGE web app; native code exists only for what the
// browser can never do (READ_CALL_LOG). Web content URL is configurable:
//   CALL_SHIELD_WEB_URL=https://your-prod-host npm run sync
// defaults to the production site. Dev: point it at your local dev server.
const webUrl = process.env.CALL_SHIELD_WEB_URL || "https://409marketplace.online";

const config: CapacitorConfig = {
  appId: "online.marketplace409.forge",
  appName: "FORGE Call Shield",
  webDir: "www",
  server: {
    url: webUrl,
    cleartext: webUrl.startsWith("http://"),
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
