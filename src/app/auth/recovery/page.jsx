"use client";

// Self-service MFA recovery (Layer 2).
//
// ACTUAL GATEWAY CONTRACT (verified against src/app/api/auth/recovery/route.js;
// see ROUTE GAPS in src/lib/auth/authGateway.js):
//   initiate: POST { access_token, operationId, action:'initiate' }
//             -> { status:'recovery_initiated' }
//   complete: POST { access_token, operationId, action:'complete', recovery_code }
//             -> { status:'recovery_pending', generation_id, message }
//
// The access_token is a valid first-factor session (validated server-side) —
// it IS the fresh first factor; no password re-entry is needed or accepted
// here. Success enters RECOVERY_PENDING: permission to enroll a NEW
// authenticator, NOT workspace access and NOT AAL2. The page says so
// explicitly and links to /auth/mfa?mode=enroll for the mandatory
// re-enrollment.
//
// Security notes (brief: Recovery and break-glass):
// - The recovery code is consumed atomically server-side (one concurrent
//   winner); one code authorizes one reset only. This page never stores it
//   beyond the completing request.
// - A fresh password alone cannot disable MFA — a code is always required,
//   and the recovery latch denies the old session family even while provider
//   revocation propagates.
// - Recovery is a Layer 2-only flow: with activation disabled the route 501s.
//   This page is inert until then.

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import {
  gatewayErrorMessage,
  gatewayRecoveryComplete,
  gatewayRecoveryInitiate,
  getBrowserAccessToken,
  newOperationId,
} from "@/lib/auth/authGateway.js";
import { useEffect, useRef, useState } from "react";

const supabase = createClient();

export default function RecoveryPage() {
  const [phase, setPhase] = useState("starting");
  const [accessToken, setAccessToken] = useState(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const actionRef = useRef(null);

  // A valid first-factor session is the entry ticket: without one, recovery
  // cannot start (the route 401s). Send the user to sign in first, carrying
  // them back here afterwards.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getBrowserAccessToken(supabase);
      if (cancelled) return;
      if (!token) {
        setPhase("signin");
        return;
      }
      setAccessToken(token);
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled && data?.user?.email) setEmail(data.user.email);
      } catch {
        // Email display is a convenience; the token is what matters.
      }
      if (!cancelled) setPhase("confirm");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    actionRef.current?.focus();
  }, [phase]);

  async function initiate() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const result = await gatewayRecoveryInitiate({ operationId: newOperationId(), accessToken });
    setBusy(false);
    if (result.status !== "recovery_initiated") {
      // Generic server-side: no oracle for session validity details.
      setMessage(gatewayErrorMessage(result));
      return;
    }
    setPhase("code");
  }

  async function complete(event) {
    event.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setMessage("Enter one of your recovery codes.");
      actionRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await gatewayRecoveryComplete({
      operationId: newOperationId(),
      accessToken,
      recoveryCode: trimmed,
    });
    setBusy(false);
    // The code must not outlive the completing request.
    setCode("");
    if (result.status !== "recovery_pending") {
      // Same generic response for wrong code, consumed code, wrong user or
      // wrong generation: no oracle.
      setMessage(gatewayErrorMessage(result));
      actionRef.current?.focus();
      return;
    }
    setPhase("pending");
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <section className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-4 text-4xl font-extrabold">Recover authenticator access</h1>

          {message ? (
            <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
              {message}
            </p>
          ) : null}

          {phase === "starting" ? (
            <p role="status" className="text-gray-600">Checking your sign-in…</p>
          ) : null}

          {phase === "signin" ? (
            <div>
              <p className="mb-6 text-gray-600">
                Recovery starts from a fresh sign-in. Sign in with your email and password first —
                you&apos;ll come back here to enter your recovery code.
              </p>
              <a
                href="/auth?next=%2Fauth%2Frecovery"
                className="block w-full rounded-2xl bg-blue-900 py-4 text-center text-xl font-bold text-white"
              >
                Go to sign in
              </a>
            </div>
          ) : null}

          {phase === "confirm" ? (
            <div>
              <p className="mb-2 text-gray-600">
                Step 1 of 2 — confirm it&apos;s you.
              </p>
              <p className="mb-6 rounded-xl bg-gray-50 p-4 text-sm">
                You&apos;re signed in{email ? <> as <strong>{email}</strong></> : ""}. That fresh
                sign-in is the first factor; the recovery code is the second.
              </p>
              <button
                ref={actionRef}
                type="button"
                onClick={initiate}
                disabled={busy}
                className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-60"
              >
                {busy ? "Checking…" : "Continue"}
              </button>
              <a href="/auth" className="mt-5 block text-center text-sm font-semibold text-blue-900 underline">
                Cancel and back to sign in
              </a>
            </div>
          ) : null}

          {phase === "code" ? (
            <div>
              <p className="mb-6 text-gray-600">
                Step 2 of 2 — enter one of the recovery codes you saved when you set up two-factor
                authentication. Each code works once.
              </p>
              <form onSubmit={complete}>
                <label htmlFor="recovery-code" className="mb-2 block text-sm font-semibold text-gray-700">
                  Recovery code
                </label>
                <input
                  id="recovery-code"
                  ref={actionRef}
                  className="mb-6 w-full rounded-xl border px-4 py-4 font-mono"
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-60"
                >
                  {busy ? "Verifying…" : "Use recovery code"}
                </button>
              </form>
              <a href="/auth" className="mt-5 block text-center text-sm font-semibold text-blue-900 underline">
                Cancel and back to sign in
              </a>
            </div>
          ) : null}

          {phase === "pending" ? (
            <div>
              <p role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
                Your authenticator has been reset. <strong>This does not sign you in and does not
                restore access to your workspace.</strong> Before you can access anything, you must
                set up and verify a new authenticator app.
              </p>
              <a
                href="/auth/mfa?mode=enroll"
                ref={actionRef}
                className="block w-full rounded-2xl bg-blue-900 py-4 text-center text-xl font-bold text-white"
              >
                Set up a new authenticator
              </a>
              <a href="/auth" className="mt-5 block text-center text-sm font-semibold text-blue-900 underline">
                Back to sign in
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
