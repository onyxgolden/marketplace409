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
  // Session-scoped dismiss: hides the banner without recording any tracking
  // choice, so an undecided visitor is never forced into a consent decision.
  const [snoozed, setSnoozed] = useState(false);

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
      {config?.enabled && consent === ANALYTICS_CONSENT.UNDECIDED && !snoozed ? (
        <aside
          aria-label="Anonymous analytics choice"
          // pointer-events-none on the container so the fixed banner can never
          // swallow clicks meant for page controls beneath it; only the real
          // interactive elements below re-enable pointer events.
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
          <button
            type="button"
            onClick={() => setSnoozed(true)}
            aria-label="Dismiss for now"
            title="Dismiss for now"
            className="pointer-events-auto absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-xl font-bold leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <span aria-hidden="true">&times;</span>
          </button>
          <h2 className="pr-8 text-base font-black text-slate-950 dark:text-white">Help improve FORGE?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
            Allow a few anonymous product-usage events so we can see which workflows work and where errors occur. We do not record screens, clicks, typed text, names, contact details, addresses, tenant or borrower information, or financial and payment data.
          </p>
          <div className="pointer-events-auto mt-4 flex flex-wrap gap-3">
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
