"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

export default function PlaidConnectButton() {
  const [linkToken, setLinkToken] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Connect a sandbox bank account through Plaid Link.");

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

      setStatus("connected");
      setMessage(
        metadata?.institution?.name
          ? `Connected ${metadata.institution.name}. Item ${data.itemId} is ready for import.`
          : `Bank connected. Item ${data.itemId} is ready for import.`,
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Plaid token exchange failed.");
    }
  }, []);

  const onExit = useCallback((error) => {
    if (error) {
      setStatus("error");
      setMessage(error.display_message ?? error.error_message ?? "Plaid Link exited with an error.");
      return;
    }

    setMessage("Plaid Link closed before connecting.");
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  });

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm uppercase tracking-wide text-slate-500">
        Bank Connection
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950">
        Connect Bank
      </div>

      <p className="mt-3 text-sm text-slate-600">
        {message}
      </p>

      <button
        type="button"
        disabled={!ready || status === "loading" || status === "exchanging"}
        onClick={() => open()}
        className="mt-5 rounded-2xl border border-slate-900 bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
      >
        {status === "loading"
          ? "Preparing..."
          : status === "exchanging"
            ? "Securing..."
            : "Connect Bank"}
      </button>

      <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-xs font-bold uppercase tracking-wide text-slate-500">
        Status: {status}
      </div>
    </div>
  );
}
