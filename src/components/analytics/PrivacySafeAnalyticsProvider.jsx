"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { browserAnalyticsEnvironment, readAnalyticsConfig } from "@/lib/analytics/config";
import {
  ANALYTICS_CONSENT,
  denyAnalyticsConsent,
  grantAnalyticsConsent,
  readAnalyticsConsent,
} from "@/lib/analytics/consent";
import { captureApprovedEvent, initializeAnalytics } from "@/lib/analytics/client";
import { ANALYTICS_EVENTS, surfaceFromPathname } from "@/lib/analytics/policy";

export default function PrivacySafeAnalyticsProvider({ children }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [config] = useState(() => readAnalyticsConfig(browserAnalyticsEnvironment()));
  const [consent, setConsent] = useState(ANALYTICS_CONSENT.UNDECIDED);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setConsent(readAnalyticsConsent()), 0);
    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    if (!config?.enabled || consent !== ANALYTICS_CONSENT.GRANTED) return undefined;

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
  }, [config, consent]);

  useEffect(() => {
    if (!ready) return;
    const surface = surfaceFromPathname(pathname);
    captureApprovedEvent(ANALYTICS_EVENTS.NAVIGATION, {
      surface,
      destination: surface,
    });
  }, [pathname, ready]);

  const decide = (decision) => {
    const stored = decision === ANALYTICS_CONSENT.GRANTED
      ? grantAnalyticsConsent()
      : denyAnalyticsConsent();
    setConsent(stored ? decision : ANALYTICS_CONSENT.DENIED);
  };

  return (
    <>
      {children}
      {config?.enabled && consent === ANALYTICS_CONSENT.UNDECIDED ? (
        <aside
          aria-label="Anonymous analytics choice"
          className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
          <h2 className="text-base font-black text-slate-950 dark:text-white">Help improve FORGE?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
            Allow a few anonymous product-usage events so we can see which workflows work and where errors occur. We do not record screens, clicks, typed text, names, contact details, addresses, tenant or borrower information, or financial and payment data.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => decide(ANALYTICS_CONSENT.GRANTED)}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-slate-950"
            >
              Allow anonymous analytics
            </button>
            <button
              type="button"
              onClick={() => decide(ANALYTICS_CONSENT.DENIED)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 dark:border-slate-700 dark:text-slate-200"
            >
              No thanks
            </button>
            <a href="/privacy#analytics" className="self-center text-sm font-bold text-blue-700 underline dark:text-blue-300">
              Privacy details
            </a>
          </div>
        </aside>
      ) : null}
    </>
  );
}
