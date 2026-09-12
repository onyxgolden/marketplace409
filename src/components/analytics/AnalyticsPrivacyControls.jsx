"use client";

import { useEffect, useState } from "react";
import {
  ANALYTICS_CONSENT,
  denyAnalyticsConsent,
  grantAnalyticsConsent,
  readAnalyticsConsent,
  revokeAnalyticsConsent,
} from "@/lib/analytics/consent";

export default function AnalyticsPrivacyControls() {
  const [consent, setConsent] = useState(ANALYTICS_CONSENT.UNDECIDED);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setConsent(readAnalyticsConsent()), 0);
    return () => globalThis.clearTimeout(timer);
  }, []);

  const save = (decision) => {
    if (decision === ANALYTICS_CONSENT.UNDECIDED) {
      revokeAnalyticsConsent();
      setConsent(decision);
      globalThis.location?.reload();
      return;
    }
    const stored = decision === ANALYTICS_CONSENT.GRANTED
      ? grantAnalyticsConsent()
      : denyAnalyticsConsent();
    setConsent(stored ? decision : ANALYTICS_CONSENT.DENIED);
    globalThis.location?.reload();
  };

  return (
    <div className="rounded-xl border border-gray-300 bg-gray-50 p-4">
      <p className="font-semibold">Current choice: {consent}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => save(ANALYTICS_CONSENT.GRANTED)} className="rounded-lg bg-gray-900 px-4 py-2 font-bold text-white">
          Allow anonymous analytics
        </button>
        <button type="button" onClick={() => save(ANALYTICS_CONSENT.DENIED)} className="rounded-lg border border-gray-400 px-4 py-2 font-bold">
          Disable analytics
        </button>
        <button type="button" onClick={() => save(ANALYTICS_CONSENT.UNDECIDED)} className="rounded-lg px-4 py-2 font-bold underline">
          Ask me again
        </button>
      </div>
    </div>
  );
}
