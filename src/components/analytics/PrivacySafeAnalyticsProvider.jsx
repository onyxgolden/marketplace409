"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { browserAnalyticsEnvironment, readAnalyticsConfig } from "@/lib/analytics/config";
import { hasAnalyticsConsent } from "@/lib/analytics/consent";
import { captureApprovedEvent, initializeAnalytics } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS, surfaceFromPathname } from "@/lib/analytics/policy";

export default function PrivacySafeAnalyticsProvider({ children }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const config = readAnalyticsConfig(browserAnalyticsEnvironment());
    if (!config.enabled || !hasAnalyticsConsent()) return undefined;

    initializeAnalytics(config)
      .then((client) => {
        if (active && client) setReady(true);
      })
      .catch(() => {
        // Analytics is optional and must fail closed without affecting FORGE.
        if (active) setReady(false);
      });
    return () => {
      active = false;
    };
  }, []); // Intentionally initialize once; later path changes are captured below.

  useEffect(() => {
    if (!ready) return;
    const surface = surfaceFromPathname(pathname);
    captureApprovedEvent(ANALYTICS_EVENTS.NAVIGATION, {
      surface,
      destination: surface,
    });
  }, [pathname, ready]);

  return children;
}
