"use client";

import { useEffect, useRef, useState } from "react";

import { TURNSTILE_SCRIPT_URL } from "@/lib/auth/turnstilePolicy.js";

// Cloudflare Turnstile widget (explicit render).
//
// Renders the managed, low-friction Turnstile widget and reports the
// single-use token to the parent via onToken. The token is consumed by
// exactly one submit; the parent clears it and remounts this widget (via
// React `key`) after every attempt so the next attempt gets a fresh token.
//
// The widget only ever mounts when Turnstile is enabled (the parent gates
// on isTurnstileEnabled()), so with the flag off this file loads no script
// and makes no third-party request — zero friction, zero new network call.
//
// Failure is visible and retriable, never silent: if the Cloudflare script
// fails to load, or the widget reports an error, the user sees a plain-words
// message and a Try again button (44px target). A submit is blocked until a
// token exists, so a broken widget can never silently bypass the check.
//
// No secret lives here — only the public site key, which Cloudflare
// publishes in the page by design.

let scriptLoadPromise = null;

function ensureTurnstileScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile requires a browser window."));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Turnstile script loaded without window.turnstile."));
      });
      existing.addEventListener("error", () =>
        reject(new Error("Turnstile script failed to load."))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile script loaded without window.turnstile."));
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error("Turnstile script failed to load."));
    };
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export default function TurnstileWidget({
  siteKey,
  action = "auth",
  onToken,
  onExpired,
  onError,
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  // Latest callbacks in refs so the render effect does not re-run when the
  // parent passes new inline closures on every render. Updated in an effect
  // (not during render) per the react-hooks/refs rule.
  const callbacksRef = useRef({ onToken, onExpired, onError });
  useEffect(() => {
    callbacksRef.current = { onToken, onExpired, onError };
  });
  // A missing site key (production with no key configured) is a render-time
  // fact, not effect state: the widget cannot render and the failure UI
  // shows. loadFailed covers only async failures (script load / render).
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failed = !siteKey || loadFailed;

  useEffect(() => {
    if (!siteKey) {
      return undefined;
    }
    let cancelled = false;
    ensureTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        try {
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: "auto",
            size: "normal",
            callback: (token) => callbacksRef.current.onToken?.(token),
            "expired-callback": () => callbacksRef.current.onExpired?.(),
            "error-callback": () => {
              setLoadFailed(true);
              callbacksRef.current.onError?.();
            },
          });
        } catch {
          if (!cancelled) setLoadFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && typeof window !== "undefined" && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Already removed (StrictMode double-effect); nothing to do.
        }
        widgetIdRef.current = null;
      }
    };
    // Re-render only when the key, action, or an explicit retry changes.
    // callbacksRef is a stable ref (updated in its own effect) and
    // setLoadFailed is a stable setter, so they are not dependencies.
  }, [siteKey, action, attempt]);

  if (failed) {
    return (
      <div className="mb-4 rounded-xl bg-amber-50 p-4">
        <p role="status" className="mb-3 text-sm text-amber-950">
          Human verification didn&apos;t load. Check your connection and try again — sign-in
          stays blocked until the check completes.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadFailed(false);
            setAttempt((n) => n + 1);
          }}
          className="min-h-[44px] rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div ref={containerRef} className="min-h-[65px]" aria-label="Human verification" />
      <p role="status" className="sr-only">
        Loading human verification.
      </p>
    </div>
  );
}
