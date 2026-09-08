"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";

// Mirrors PlaidConnectButton.js's structure and states (idle/loading/ready/connecting/exchanging/
// connected/error), swapped to Stripe Financial Connections' own hosted flow
// (stripe.collectFinancialConnectionsAccounts) instead of react-plaid-link's usePlaidLink. No
// stripeAccount param on loadStripe -- this session belongs to the platform account (the FORGE
// workspace owner's own bank data), never a Connect-connected account.
export default function StripeFinancialConnectionsButton() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(
    "Connect a bank account to securely import authorized financial information.",
  );
  const [connectedAccountCount, setConnectedAccountCount] = useState(null);
  const stripePromiseRef = useRef(null);

  // Nested (not a useCallback reference) so this call sits directly in the effect body, matching
  // the shape every other mount-time data-loading effect in this codebase already uses (see
  // usePersistedBoard.js) -- a useCallback'd reference here trips react-hooks/set-state-in-effect's
  // conservative analysis even though nothing here runs before the first await. retry() below
  // covers the same fetch for the error state's manual retry button -- run from a click handler,
  // never inside an effect -- so it isn't subject to that rule at all, and can stay a useCallback.
  useEffect(() => {
    let active = true;

    async function createSession() {
      try {
        setStatus("loading");
        setMessage("Preparing a secure Stripe connection session...");

        const response = await fetch("/api/stripe/financial-connections/session", { method: "POST" });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to create a Stripe Financial Connections session.");
        }

        if (active) {
          setSession(data);
          setStatus("ready");
          setMessage("Ready to securely connect your bank.");
        }
      } catch (error) {
        if (active) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Stripe session setup failed.");
        }
      }
    }

    createSession();
    return () => {
      active = false;
    };
  }, []);

  const retry = useCallback(async () => {
    setConnectedAccountCount(null);
    try {
      setStatus("loading");
      setMessage("Preparing a secure Stripe connection session...");

      const response = await fetch("/api/stripe/financial-connections/session", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to create a Stripe Financial Connections session.");
      }

      setSession(data);
      setStatus("ready");
      setMessage("Ready to securely connect your bank.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Stripe session setup failed.");
    }
  }, []);

  const resolveStripe = useCallback(() => {
    if (!stripePromiseRef.current) {
      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      stripePromiseRef.current = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);
    }
    return stripePromiseRef.current;
  }, []);

  const connect = useCallback(async () => {
    if (!session) return;

    try {
      setStatus("connecting");
      setMessage("Opening Stripe's secure bank connection window...");

      const stripe = await resolveStripe();
      if (!stripe) {
        throw new Error("Stripe could not be initialized.");
      }

      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: session.clientSecret,
      });

      if (result.error) {
        // Stripe.js reports a cancelled/closed flow as an error result, not a thrown exception --
        // no accounts were authorized and nothing was imported.
        setStatus("idle");
        setMessage("No bank was connected. You can return at any time to securely connect an account.");
        return;
      }

      setStatus("exchanging");
      setMessage("Bank connected. Securing your data...");

      const response = await fetch("/api/stripe/financial-connections/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to complete the Stripe Financial Connections session.");
      }

      setConnectedAccountCount(data.accountCount ?? 0);
      setStatus("connected");
      setMessage(
        `${data.accountCount ?? 0} account${data.accountCount === 1 ? "" : "s"} connected successfully. Preparing your financial dashboard...`,
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not complete the secure connection. No financial information was imported. Please try again.",
      );
    }
  }, [session, resolveStripe]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Bank Connection
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
        Secure Bank Connection
      </div>

      <div className="mt-3 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        Secure connection powered by Stripe
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
        {message}
      </p>

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:bg-slate-800/60 dark:border-slate-800">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Why connect?
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <li>• Import authorized transaction history.</li>
            <li>• Build financial reports and cash-flow insights.</li>
            <li>• Support rental and business performance tracking.</li>
            <li>• Power forecasting and explainable recommendations.</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:bg-slate-800/60 dark:border-slate-800">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Information you authorize
          </div>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            FORGE may receive account details, balances, transactions, and
            institution information for the accounts you choose to share.
          </p>
          <p className="mt-3 text-sm font-bold text-slate-900 dark:text-slate-50">
            Stripe handles your bank sign-in. FORGE never receives your online
            banking username or password.
          </p>
        </div>
      </div>

      {status === "connected" && connectedAccountCount !== null ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="font-black">
            ✓ {connectedAccountCount} account{connectedAccountCount === 1 ? "" : "s"} connected
          </div>
          <div className="mt-1">
            Authorization completed. Opening your connection dashboard.
          </div>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
          <div className="font-black">Connection failed</div>
          <div className="mt-1">{message}</div>
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-red-800 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300"
          >
            Try again
          </button>
        </div>
      ) : null}

      <button
        type="button"
        disabled={status === "loading" || status === "connecting" || status === "exchanging" || status === "connected" || !session}
        aria-busy={status === "loading" || status === "connecting" || status === "exchanging"}
        onClick={connect}
        className="mt-5 rounded-2xl border border-slate-900 bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 dark:border-amber-300 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 dark:disabled:border-slate-700 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {status === "loading"
          ? "Preparing..."
          : status === "connecting"
            ? "Connecting..."
            : status === "exchanging"
              ? "Securing..."
              : status === "connected"
                ? "Connected"
                : "Connect Bank"}
      </button>

      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        By continuing, you will securely connect through Stripe. You choose
        which accounts to share, and FORGE accesses only the information you
        authorize.
      </p>

      <div className="mt-3 flex flex-wrap gap-4 text-xs font-bold">
        <a className="text-slate-700 underline hover:text-slate-950 dark:text-slate-300 dark:hover:text-white" href="/privacy">
          Privacy Policy
        </a>
        <a className="text-slate-700 underline hover:text-slate-950 dark:text-slate-300 dark:hover:text-white" href="/terms">
          Terms of Service
        </a>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        Status: {status}
      </div>
    </div>
  );
}
