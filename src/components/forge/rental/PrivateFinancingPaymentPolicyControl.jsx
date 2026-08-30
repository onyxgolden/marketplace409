"use client";

import { useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const OPTIONS = [
  {
    value: "partial_allowed",
    label: "Partial payments allowed",
    explanation: "Borrowers may submit less than the full amount currently due.",
  },
  {
    value: "full_amount_or_more",
    label: "Full amount or more required",
    explanation: "Blocks borrower-initiated payments below the full amount due; extra principal may be allowed by the account’s terms.",
  },
  {
    value: "exact_amount_only",
    label: "Exact amount only",
    explanation: "Borrowers must submit exactly the amount due—neither less nor more.",
  },
];

const labelFor = (value) => OPTIONS.find((option) => option.value === value)?.label ?? value;

export default function PrivateFinancingPaymentPolicyControl({
  accountId,
  currentPolicy,
  onChanged,
}) {
  const [editing, setEditing] = useState(false);
  const [policy, setPolicy] = useState(currentPolicy);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [savedPolicy, setSavedPolicy] = useState(null);

  const cancel = () => {
    setEditing(false);
    setPolicy(currentPolicy);
    setReason("");
    setAcknowledged(false);
    setError("");
    setStatus("idle");
  };

  const save = async () => {
    if (!acknowledged || !reason.trim() || policy === currentPolicy || status === "saving") return;
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(
        `/api/private-financing/accounts/${accountId}/servicing-policy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            paymentAcceptancePolicy: policy,
            effectiveAt: new Date().toISOString(),
            reason: reason.trim(),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to change the payment rule.");
      setSavedPolicy(payload.servicingPolicy);
      setEditing(false);
      setStatus("saved");
      setAcknowledged(false);
      setReason("");
      onChanged?.();
    } catch (saveError) {
      setError(saveError.message);
      setStatus("error");
    }
  };

  return (
    <section
      aria-labelledby="pf-payment-policy-heading"
      className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700"
    >
      <h3 id="pf-payment-policy-heading" className="text-lg font-black text-slate-950 dark:text-white">
        Online payment rule
      </h3>
      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">
        Current rule: {labelFor(savedPolicy?.paymentAcceptancePolicy ?? currentPolicy)}
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        This rule governs payments a borrower starts through FORGE. It never prevents you from truthfully
        recording Venmo, Cash App, cash, check, or other money already received.
      </p>

      {!editing ? (
        <button
          type="button"
          data-guided-workflow-control="change-payment-policy"
          onClick={() => {
            setPolicy(savedPolicy?.paymentAcceptancePolicy ?? currentPolicy);
            setEditing(true);
            setStatus("idle");
          }}
          className={`mt-4 rounded-lg px-4 py-2 text-sm font-bold ${goldControlClassName} ${FOCUS_RING}`}
        >
          Change payment rule
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <fieldset>
            <legend className="text-sm font-black text-slate-950 dark:text-white">Choose the borrower payment rule</legend>
            <div className="mt-3 space-y-3">
              {OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm text-slate-900 dark:text-white">
                  <input
                    type="radio"
                    name="payment-policy"
                    value={option.value}
                    checked={policy === option.value}
                    onChange={(event) => {
                      setPolicy(event.target.value);
                      setAcknowledged(false);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{option.explanation}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">
            Reason for changing this rule
            <input
              type="text"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="mt-3 flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1"
            />
            I understand this creates a new prospective policy version and does not rewrite prior payments.
          </label>

          {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-800 dark:text-red-300">{error}</p> : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={!acknowledged || !reason.trim() || policy === currentPolicy || status === "saving"}
              onClick={save}
              data-guided-workflow-control="save-payment-policy"
              className={`rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 ${FOCUS_RING}`}
            >
              {status === "saving" ? "Saving…" : "Confirm rule change"}
            </button>
            <button type="button" onClick={cancel} className={`rounded-lg border px-4 py-2 text-sm font-bold ${FOCUS_RING}`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "saved" ? (
        <p role="status" className="mt-3 text-sm font-bold text-emerald-800 dark:text-emerald-300">
          Payment rule changed to {labelFor(savedPolicy.paymentAcceptancePolicy)}.
        </p>
      ) : null}
    </section>
  );
}
