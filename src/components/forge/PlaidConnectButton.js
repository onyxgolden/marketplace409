"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

export default function PlaidConnectButton() {
  const [linkToken, setLinkToken] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(
    "Connect an account to securely import authorized financial information.",
  );
  const [connectedInstitution, setConnectedInstitution] = useState(null);

  useEffect(() => {
    let active = true;

    async function createLinkToken() {
      try {
        setStatus("loading");
        setMessage("Preparing secure Plaid Link session...");

        const response = await fetch("/api/plaid/link-token", {
          method: "POST",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to create Plaid Link token.");
        }

        if (active) {
          setLinkToken(data.linkToken);
          setStatus("ready");
          setMessage("Plaid Link is ready.");
        }
      } catch (error) {
        if (active) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Plaid Link setup failed.");
        }
      }
    }

    createLinkToken();

    return () => {
      active = false;
    };
  }, []);

  const onSuccess = useCallback(async (publicToken, metadata) => {
    try {
      setStatus("exchanging");
      setMessage(
        metadata?.institution?.name
          ? `Connected ${metadata.institution.name}. Exchanging secure token...`
          : "Bank connected. Exchanging secure token...",
      );

      const response = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          publicToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to exchange Plaid token.");
      }

      const institutionName =
        metadata?.institution?.name || "Financial institution";

      setConnectedInstitution(institutionName);
      setStatus("connected");
      setMessage(
        `${institutionName} connected successfully. Preparing your financial dashboard...`,
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
  }, []);

  const onExit = useCallback((error) => {
    if (error) {
      setStatus("error");
      setMessage(error.display_message ?? error.error_message ?? "Plaid Link exited with an error.");
      return;
    }

    setStatus("idle");
    setMessage(
      "No account was connected. You can return at any time to securely connect an institution.",
    );
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  });

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Bank Connection
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
        Secure Bank Connection
      </div>

      <div className="mt-3 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        Secure connection powered by Plaid
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
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
            Plaid handles your bank sign-in. FORGE never receives your online
            banking username or password.
          </p>
        </div>
      </div>

      {connectedInstitution ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="font-black">
            ✓ {connectedInstitution} connected
          </div>
          <div className="mt-1">
            Authorization completed. Opening your connection dashboard.
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled={!ready || status === "loading" || status === "exchanging"}
        onClick={() => open()}
        className="mt-5 rounded-2xl border border-slate-900 bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 dark:border-amber-300 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 dark:disabled:border-slate-700 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {status === "loading"
          ? "Preparing..."
          : status === "exchanging"
            ? "Securing..."
            : "Connect Bank"}
      </button>

      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        By continuing, you will securely connect through Plaid. You choose
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
