"use client";

// MFA enrollment and challenge page (Layer 2).
//
// ?mode=enroll    — enroll a TOTP factor (QR + manual key), challenge it,
//                   verify a code, then the one-time recovery-code step.
// ?mode=challenge — challenge an existing factor and verify a code.
// ?next=          — destination after the ceremony (validated same-origin).
//
// ACTUAL GATEWAY CONTRACT (verified against src/app/api/auth/mfa/route.js;
// see ROUTE GAPS in src/lib/auth/authGateway.js):
//   enroll:   POST { access_token, operationId, action:'enroll' }
//             -> { status:'ok', factor_id, qr_code, manual_key }
//   challenge:POST { access_token, operationId, action:'challenge', factor_id }
//             -> { status:'ok', challenge_id }
//   verify:   POST { access_token, operationId, action:'verify',
//                    factor_id, challenge_id, code }
//             -> { status:'ok', session }   (provider-issued AAL2 session;
//                the browser establishes it via setSession)
//             -> 401 { error }              (wrong/expired code — same generic
//                response; the UI never distinguishes the two)
//
// The access_token comes from the browser session, established via
// supabase.auth.setSession() after the gateway sign-in. Secrets (QR data,
// manual key, codes) stay transient: rendered from responses, never logged,
// never persisted.
//
// ROUTE GAPS affecting this page (see authGateway.js):
//   GAP-1 (CLOSED): sign-in mfa_required now includes the AAL1 ceremony
//     session; the page establishes it via setSession and proceeds.
//   GAP-2: the issue_recovery_codes action exists; the codes step shows them
//     once behind the mandatory acknowledgement gate.
//   GAP-3 (CLOSED): factor discovery via the list_factors action; the
//     ?factor_id= bridge remains only for old deep links.

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import {
  gatewayErrorMessage,
  gatewayMfaChallenge,
  gatewayMfaEnroll,
  gatewayMfaIssueRecoveryCodes,
  gatewayMfaListFactors,
  gatewayMfaVerify,
  getBrowserAccessToken,
  newOperationId,
} from "@/lib/auth/authGateway.js";
import { useEffect, useRef, useState } from "react";

const supabase = createClient();

function currentParams() {
  return new URLSearchParams(window.location.search);
}

function nextDestination() {
  const requested = currentParams().get("next");
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/forge/financial";
}

export default function MfaPage() {
  const params = typeof window !== "undefined" ? currentParams() : new URLSearchParams();
  const mode = params.get("mode") === "enroll" ? "enroll" : "challenge";
  // TODO(route-gap-3): temporary bridge until the gateway provides factor
  // discovery (list action or factor_id on the sign-in mfa_required response).
  // A factor id alone grants nothing without the session + TOTP code.
  const bridgedFactorId = params.get("factor_id") || "";

  const [phase, setPhase] = useState("starting");
  const [accessToken, setAccessToken] = useState(null);
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [qrBroken, setQrBroken] = useState(false);
  const [manualKey, setManualKey] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const codeInputRef = useRef(null);

  // Resolve the first-factor session, then (enroll mode) start the ceremony.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getBrowserAccessToken(supabase);
      if (cancelled) return;
      if (!token) {
        // ROUTE GAP 1: the sign-in mfa_required response withholds the
        // session, so a user arriving here from a gateway sign-in has no
        // token for the ceremony. Show this instead of failing cryptically.
        setPhase("nosession");
        return;
      }
      setAccessToken(token);
      if (mode === "enroll") {
        const result = await gatewayMfaEnroll({ operationId: newOperationId(), accessToken: token });
        if (cancelled) return;
        if (result.status === "ok" && result.factor_id && result.qr_code && result.manual_key) {
          setFactorId(result.factor_id);
          setQrCode(result.qr_code);
          setManualKey(result.manual_key);
          setPhase("scan");
        } else {
          setMessage(gatewayErrorMessage(result));
          setPhase("error");
        }
      } else {
        // Challenge mode: discover the user's verified factors through the
        // gateway (list_factors). The ?factor_id= bridge is kept as a
        // fallback for deep links minted before discovery existed.
        let discovered = bridgedFactorId;
        if (!discovered) {
          const list = await gatewayMfaListFactors({ operationId: newOperationId(), accessToken: token });
          if (cancelled) return;
          if (list.status === "ok" && Array.isArray(list.factors) && list.factors.length > 0) {
            discovered = list.factors[0].id;
          }
        }
        if (discovered) {
          setFactorId(discovered);
          setPhase("challenge");
        } else {
          setMessage("No verified authenticator found on this account. Enroll one first.");
          setPhase("nofactor");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once on mount: re-running would mint duplicate enrollments/challenges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move keyboard focus to the code field whenever it appears.
  useEffect(() => {
    if ((phase === "scan" || phase === "challenge") && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [phase]);

  async function verifyCode(event) {
    event.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setMessage("Enter the 6-digit code from your authenticator app.");
      codeInputRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    // Supabase MFA: challenge first (binds this verification attempt), then verify.
    const challengeResult = await gatewayMfaChallenge({
      operationId: newOperationId(),
      accessToken,
      factorId,
    });
    if (challengeResult.status !== "ok" || !challengeResult.challenge_id) {
      setBusy(false);
      setMessage(gatewayErrorMessage(challengeResult));
      return;
    }
    const verifyResult = await gatewayMfaVerify({
      operationId: newOperationId(),
      accessToken,
      factorId,
      challengeId: challengeResult.challenge_id,
      code: trimmed,
    });
    setBusy(false);
    if (verifyResult.status !== "ok" || !verifyResult.session?.access_token) {
      // Generic on purpose: wrong vs expired codes are indistinguishable here
      // (the route returns the same 401 either way).
      setMessage(gatewayErrorMessage(verifyResult));
      setCode("");
      codeInputRef.current?.focus();
      return;
    }
    // The provider issued the AAL2 session: establish it in the browser, then
    // continue to the one-time recovery-code step (enroll) or onward.
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: verifyResult.session.access_token,
      refresh_token: verifyResult.session.refresh_token,
    });
    if (sessionError) {
      setMessage(sessionError.message);
      return;
    }
    if (mode === "enroll") {
      // After a newly enrolled factor verifies, issue the one-time recovery
      // codes. They are displayed once behind a mandatory acknowledgement
      // and never persisted.
      const codesResult = await gatewayMfaIssueRecoveryCodes({
        operationId: newOperationId(),
        accessToken: verifyResult.session.access_token,
        factorId,
      });
      const codes =
        codesResult.status === "ok" && Array.isArray(codesResult.recovery_codes)
          ? codesResult.recovery_codes
          : [];
      setRecoveryCodes(codes);
      setPhase("codes");
    } else {
      window.location.href = nextDestination();
    }
  }

  function retryEnroll() {
    setMessage("");
    setCode("");
    setFactorId("");
    setQrCode("");
    setQrBroken(false);
    setManualKey("");
    setPhase("starting");
    gatewayMfaEnroll({ operationId: newOperationId(), accessToken }).then((result) => {
      if (result.status === "ok" && result.factor_id && result.qr_code && result.manual_key) {
        setFactorId(result.factor_id);
        setQrCode(result.qr_code);
        setManualKey(result.manual_key);
        setPhase("scan");
      } else {
        setMessage(gatewayErrorMessage(result));
        setPhase("error");
      }
    });
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (permissions, insecure context): the value stays
      // fully visible for manual transcription, so stay silent.
    }
    done(true);
  }

  function finishCodes() {
    // Recovery codes must not outlive this page session: drop them from state
    // before navigating anywhere. They are never logged or persisted.
    setRecoveryCodes(null);
    setAcknowledged(false);
    window.location.href = nextDestination();
  }

  const heading = mode === "enroll" ? "Set up two-factor authentication" : "Two-factor authentication";
  const showQr = qrCode.startsWith("data:");

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <section className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-4 text-4xl font-extrabold">{heading}</h1>

          {message ? (
            <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
              {message}
            </p>
          ) : null}

          {phase === "starting" ? (
            <p role="status" className="text-gray-600">Preparing your authenticator setup…</p>
          ) : null}

          {phase === "nosession" ? (
            <div>
              <p role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
                We couldn&apos;t establish your verification session. Please sign in again to continue
                setting up two-factor authentication.
              </p>
              <a
                href={`/auth?next=${encodeURIComponent("/auth/mfa?mode=" + mode)}`}
                className="block w-full rounded-2xl bg-blue-900 py-4 text-center text-xl font-bold text-white"
              >
                Back to sign in
              </a>
            </div>
          ) : null}

          {phase === "nofactor" ? (
            <div>
              <p role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
                We couldn&apos;t identify which authenticator to challenge. Please sign in again —
                your sign-in will route you to the right verification step.
              </p>
              <a
                href="/auth"
                className="block w-full rounded-2xl bg-blue-900 py-4 text-center text-xl font-bold text-white"
              >
                Back to sign in
              </a>
            </div>
          ) : null}

          {phase === "error" ? (
            <div>
              <p className="mb-6 text-gray-600">Setup didn&apos;t start. You can try again — nothing has changed on your account.</p>
              <button
                type="button"
                onClick={retryEnroll}
                className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white"
              >
                Try again
              </button>
              <a href="/auth" className="mt-5 block text-center font-semibold text-blue-900 underline">
                Back to sign in
              </a>
            </div>
          ) : null}

          {phase === "scan" ? (
            <div>
              <p className="mb-4 text-gray-600">
                Scan this code with your authenticator app, then enter the 6-digit code it shows.
              </p>
              {showQr && !qrBroken ? (
                <div className="mx-auto mb-4 w-fit rounded-2xl border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the QR is a data: URI
                      generated for this enrollment; next/image cannot optimize data URIs. */}
                  <img
                    src={qrCode}
                    alt="TOTP enrollment QR code"
                    className="h-48 w-48"
                    onError={() => setQrBroken(true)}
                  />
                </div>
              ) : (
                <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                  The QR code didn&apos;t load — use the manual key below instead.
                </p>
              )}
              <div className="mb-6 rounded-xl bg-gray-50 p-4">
                <p className="mb-2 text-sm font-semibold text-gray-700">Can&apos;t scan? Enter this key manually:</p>
                <p className="mb-2 break-all font-mono text-sm" aria-label="Manual setup key">{manualKey}</p>
                <button
                  type="button"
                  onClick={() => copyText(manualKey, setCopiedKey)}
                  className="text-sm font-semibold text-blue-900 underline"
                >
                  {copiedKey ? "Copied!" : "Copy key"}
                </button>
              </div>
              <form onSubmit={verifyCode}>
                <label htmlFor="mfa-code" className="mb-2 block text-sm font-semibold text-gray-700">
                  6-digit code
                </label>
                <input
                  id="mfa-code"
                  ref={codeInputRef}
                  className="mb-4 w-full rounded-xl border px-4 py-4 tracking-widest"
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-60"
                >
                  {busy ? "Verifying…" : "Verify and continue"}
                </button>
              </form>
              <div className="mt-5 flex items-center justify-between">
                <button type="button" onClick={retryEnroll} className="text-sm font-semibold text-blue-900 underline">
                  Get a new code
                </button>
                <a href="/auth" className="text-sm font-semibold text-blue-900 underline">
                  Cancel
                </a>
              </div>
            </div>
          ) : null}

          {phase === "challenge" ? (
            <div>
              <p className="mb-6 text-gray-600">Enter the 6-digit code from your authenticator app to continue.</p>
              <form onSubmit={verifyCode}>
                <label htmlFor="mfa-code" className="mb-2 block text-sm font-semibold text-gray-700">
                  6-digit code
                </label>
                <input
                  id="mfa-code"
                  ref={codeInputRef}
                  className="mb-4 w-full rounded-xl border px-4 py-4 tracking-widest"
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-60"
                >
                  {busy ? "Verifying…" : "Verify"}
                </button>
              </form>
              <div className="mt-5 flex items-center justify-between">
                <a href="/auth/recovery" className="text-sm font-semibold text-blue-900 underline">
                  Lost your authenticator? Use a recovery code
                </a>
                <a href="/auth" className="text-sm font-semibold text-blue-900 underline">
                  Cancel
                </a>
              </div>
            </div>
          ) : null}

          {phase === "codes" && recoveryCodes !== null ? (
            <div>
              {(recoveryCodes ?? []).length > 0 ? (
                <div>
                  <p className="mb-2 font-semibold text-amber-900">Save these recovery codes now.</p>
                  <p className="mb-4 text-sm text-gray-600">
                    Each code works once, only if you lose access to your authenticator app.
                    They will not be shown again — store them somewhere safe, separate from this device.
                  </p>
                  <ol className="mb-4 grid grid-cols-1 gap-2 rounded-xl bg-gray-50 p-4 font-mono text-sm" aria-label="Recovery codes">
                    {recoveryCodes.map((recoveryCode) => (
                      <li key={recoveryCode} className="break-all">{recoveryCode}</li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => copyText(recoveryCodes.join("\n"), () => {})}
                    className="mb-6 text-sm font-semibold text-blue-900 underline"
                  >
                    Copy all codes
                  </button>
                  <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-xl border p-4">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    <span className="text-sm font-semibold">
                      I have saved these recovery codes somewhere safe. I understand they won&apos;t be shown again.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={finishCodes}
                    disabled={!acknowledged}
                    className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              ) : (
                <div>
                  <p role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
                    Your authenticator is verified and two-factor authentication is on. One-time
                    recovery codes are not issued by the sign-in service yet — a follow-up will add
                    them to this screen. You can re-generate them from your account security settings
                    once available.
                  </p>
                  <button
                    type="button"
                    onClick={finishCodes}
                    className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white"
                  >
                    Continue
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
