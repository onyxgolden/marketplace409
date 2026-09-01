"use client";

import { useMemo, useRef, useState } from "react";
import { buildHistoricalPrivateFinancingImportPreview } from "@/domains/private-financing/historicalImportPreview";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => money.format(cents / 100);
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

export default function PrivateFinancingHistoricalImport({ onBack, onImported }) {
  const [plan, setPlan] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const requestInFlight = useRef(false);

  const preview = useMemo(() => {
    if (!plan) return null;
    try {
      return buildHistoricalPrivateFinancingImportPreview({
        calculationStartDate: plan.calculationStartDate,
        asOfDate: plan.asOfDate,
        components: plan.account.components.map((component) => ({
          componentId: component.componentKey,
          originalPrincipalCents: component.originalPrincipalCents,
          rateBps: component.rateBps,
          scheduledComponentAmountCents: component.scheduledComponentAmountCents,
          allocationPriority: component.allocationPriority,
        })),
        payments: plan.payments,
        proposedPrincipalCredits: plan.proposedPrincipalCredits,
        allocationPolicy: plan.account.allocationPolicy,
        extraPaymentAllocationPolicy: plan.account.extraPaymentAllocationPolicy,
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "This import plan is invalid." };
    }
  }, [plan]);

  async function loadFile(event) {
    const file = event.target.files?.[0];
    setPlan(null);
    setFileName(file?.name || "");
    setFileError("");
    setAcknowledged(false);
    setConfirmationText("");
    setMessage("");
    if (!file) return;
    try {
      const parsed = JSON.parse(await readTextFile(file));
      setPlan(parsed);
    } catch {
      setFileError("Choose a valid JSON historical-import plan.");
    }
  }

  async function submitImport() {
    if (!plan || preview?.error || !acknowledged || confirmationText !== "IMPORT" || requestInFlight.current) return;
    requestInFlight.current = true;
    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/private-financing/imports/historical/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...plan,
          acknowledgeIrreversible: true,
          confirmationText: "IMPORT",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to import this historical plan.");
      setStatus("success");
      setMessage(`Imported ${payload.import.paymentEventCount} payments and ${payload.import.creditEventCount} credit. Account ${payload.import.accountId}.`);
      onImported?.(payload);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to import this historical plan.");
    } finally {
      requestInFlight.current = false;
    }
  }

  const canImport = Boolean(plan && preview && !preview.error && acknowledged && confirmationText === "IMPORT" && status !== "submitting" && status !== "success");

  return (
    <div>
      <button type="button" onClick={onBack} className={`text-sm font-bold text-sky-700 dark:text-sky-400 ${FOCUS_RING}`}>
        ← Back to accounts
      </button>
      <h3 className="mt-5 text-2xl font-black text-slate-950 dark:text-white">Import historical financing</h3>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        Load a local JSON plan, reconcile it in this browser, then explicitly confirm the one-time import.
      </p>

      <label className="mt-6 block text-sm font-bold text-slate-900 dark:text-white">
        Historical-import JSON plan
        <input type="file" accept="application/json,.json" onChange={loadFile} className={`mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm dark:border-slate-700 dark:bg-slate-950 ${FOCUS_RING}`} />
      </label>
      {fileName ? <p className="mt-2 text-xs text-slate-500">Loaded: {fileName}</p> : null}
      {fileError || preview?.error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-300">{fileError || preview.error}</p> : null}

      {preview && !preview.error ? (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Historical import reconciliation">
            <Fact term="Payments" value={String(preview.paymentCount)} />
            <Fact term="Cash received" value={centsToMoney(preview.totalCashCents)} />
            <Fact term="Interest paid" value={centsToMoney(preview.totalInterestPaidCents)} />
            <Fact term="Cash principal" value={centsToMoney(preview.totalCashAppliedToPrincipalCents)} />
            <Fact term="Principal credit" value={centsToMoney(preview.totalPrincipalCreditCents)} />
            <Fact term="Principal remaining" value={centsToMoney(preview.principalAfterCreditsCents)} />
            <Fact term="Unallocated" value={centsToMoney(preview.totalUnallocatedCents)} />
            <Fact term="As of" value={preview.asOfDate} />
          </dl>

          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
            <label className="flex gap-3 text-sm font-bold text-amber-950 dark:text-amber-200">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={FOCUS_RING} />
              I reviewed this reconciliation and understand the import creates an account and immutable ledger events.
            </label>
            <label className="mt-4 block text-sm font-bold text-amber-950 dark:text-amber-200">
              Type IMPORT to confirm
              <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" className={`mt-2 block w-full max-w-xs rounded-lg border border-amber-400 bg-white px-3 py-2 text-slate-950 dark:bg-slate-950 dark:text-white ${FOCUS_RING}`} />
            </label>
            <button type="button" disabled={!canImport} onClick={submitImport} data-guided-workflow-control="confirm-historical-import" className={`mt-5 rounded-xl px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${goldControlClassName} ${FOCUS_RING}`}>
              {status === "submitting" ? "Importing…" : "Import historical account"}
            </button>
          </div>
        </>
      ) : null}

      {message ? <p role={status === "error" ? "alert" : "status"} className={`mt-4 text-sm font-bold ${status === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{message}</p> : null}
    </div>
  );
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read this file.")), { once: true });
    reader.readAsText(file);
  });
}

function Fact({ term, value }) {
  return <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt><dd className="mt-1 font-black text-slate-950 dark:text-white">{value}</dd></div>;
}
