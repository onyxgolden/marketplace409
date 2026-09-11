const APPROVED_HOSTS = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"]);

export function readAnalyticsConfig(env = {}) {
  const enabled = env.NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED === "true";
  const killed = env.NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH !== "false";
  const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY || "";
  const apiHost = env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  const configured = /^phc_[A-Za-z0-9_-]+$/.test(apiKey) && APPROVED_HOSTS.has(apiHost);

  return Object.freeze({
    apiHost,
    apiKey,
    configured,
    enabled: enabled && !killed && configured,
    killed,
    // Session replay is deliberately code-disabled for this first slice. The masking
    // options in the client remain defense in depth for a separately reviewed future change.
    sessionRecordingEnabled: false,
  });
}

export function browserAnalyticsEnvironment() {
  return {
    NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED: process.env.NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED,
    NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH: process.env.NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  };
}
