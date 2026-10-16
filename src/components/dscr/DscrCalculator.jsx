"use client";

import { useState } from "react";
import {
  computeDscr,
  illustrativeComparisons,
  DISCLAIMER,
} from "@/lib/dscr/calculator";

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-600";

function Field({ label, help, children, error }) {
  return (
    <label className="block">
      <span className="font-semibold text-sm">{label}</span>
      {help && <span className="block text-xs text-gray-500 mt-0.5">{help}</span>}
      <span className="block mt-1">{children}</span>
      {error && <span className="block text-xs text-red-700 mt-1">{error}</span>}
    </label>
  );
}

export default function DscrCalculator() {
  const [rent, setRent] = useState("");
  const [pi, setPi] = useState("");
  const [taxes, setTaxes] = useState("");
  const [insurance, setInsurance] = useState("");
  const [hoa, setHoa] = useState("");
  const [escrowInclusive, setEscrowInclusive] = useState(false);
  const [result, setResult] = useState(null);

  const num = (v) => (v === "" ? 0 : Number(v));

  function calculate(e) {
    e.preventDefault();
    const r = computeDscr({
      rent: num(rent),
      principalAndInterest: num(pi),
      taxes: num(taxes),
      insurance: num(insurance),
      hoaDues: num(hoa),
      escrowInclusive,
    });
    setResult(r);
  }

  return (
    <div className="bg-white rounded-2xl shadow p-6 md:p-8">
      <h2 className="text-2xl font-extrabold">Illustrative DSCR calculator</h2>
      <p className="text-sm text-gray-600 mt-2">
        Enter your numbers below. Everything stays in your browser — nothing is
        sent anywhere or saved.
      </p>

      <form onSubmit={calculate} className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Monthly rent basis"
          help="Your figure — lenders may use market rent, actual rent, or a vacancy-adjusted figure. This calculator does not decide which applies."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            className={inputClass}
            placeholder="e.g. 2000"
            aria-label="Monthly rent basis"
          />
        </Field>

        <Field
          label="Monthly principal & interest"
          help="The P&I portion of the mortgage payment."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={pi}
            onChange={(e) => setPi(e.target.value)}
            className={inputClass}
            placeholder="e.g. 1100"
            aria-label="Monthly principal and interest"
          />
        </Field>

        <Field
          label="Monthly property taxes"
          help={escrowInclusive ? "Disabled — included in your P&I above." : undefined}
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={taxes}
            onChange={(e) => setTaxes(e.target.value)}
            className={inputClass}
            placeholder="e.g. 200"
            disabled={escrowInclusive}
            aria-label="Monthly property taxes"
          />
        </Field>

        <Field
          label="Monthly property insurance"
          help={
            escrowInclusive
              ? "Disabled — included in your P&I above."
              : "Include flood insurance where applicable."
          }
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={insurance}
            onChange={(e) => setInsurance(e.target.value)}
            className={inputClass}
            placeholder="e.g. 120"
            disabled={escrowInclusive}
            aria-label="Monthly property insurance"
          />
        </Field>

        <Field
          label="Monthly HOA / dues / other"
          help="Association dues and any other housing expense in the payment."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={hoa}
            onChange={(e) => setHoa(e.target.value)}
            className={inputClass}
            placeholder="e.g. 0"
            aria-label="Monthly HOA dues and other housing expenses"
          />
        </Field>

        <div className="md:col-span-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={escrowInclusive}
              onChange={(e) => setEscrowInclusive(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">
                My P&I payment already includes taxes and insurance (escrow)
              </span>
              <span className="block text-xs text-gray-500">
                When checked, the separate tax and insurance fields are excluded
                so nothing is counted twice.
              </span>
            </span>
          </label>
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600"
          >
            Calculate illustrative DSCR
          </button>
        </div>
      </form>

      {result && (
        <div className="mt-6 border-t pt-6" aria-live="polite">
          {!result.ok ? (
            <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-4">
              <p className="font-bold">Cannot compute</p>
              <p className="text-sm mt-1">{result.error}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600">{result.formula}</p>
              <p className="text-5xl font-extrabold mt-2">
                {result.ratio.toFixed(3)}
                <span className="text-xl font-normal text-gray-500">x</span>
              </p>

              <ul className="mt-4 text-sm space-y-1">
                <li>
                  <span className="font-semibold">Rent basis:</span> $
                  {num(rent).toLocaleString()}
                </li>
                {result.components.map((c) => (
                  <li key={c.label} className={c.included ? "" : "text-gray-400 line-through"}>
                    <span className="font-semibold">{c.label}:</span> $
                    {c.amount.toLocaleString()}
                    {!c.included && " (excluded — in escrow)"}
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <p className="font-semibold text-sm">Illustrative comparison:</p>
                <ul className="text-sm mt-1 space-y-1">
                  {illustrativeComparisons(result.ratio).map((c) => (
                    <li key={c.threshold}>
                      {c.threshold.toFixed(2)}x — {c.label}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-4 text-xs bg-gray-100 rounded-lg p-3 text-gray-700">
                {DISCLAIMER}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
