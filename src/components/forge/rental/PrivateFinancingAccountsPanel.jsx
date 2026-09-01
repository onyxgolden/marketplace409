"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import PrivateFinancingAccountDetail from "./PrivateFinancingAccountDetail";
import PrivateFinancingHistoricalImport from "./PrivateFinancingHistoricalImport";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");

const PRODUCT_LABELS = { seller_financing: "Seller financing", personal_loan: "Personal loan" };
const STATUS_LABELS = { active: "Active", paid_off: "Paid off", written_off: "Written off", cancelled: "Cancelled" };
const POLICY_LABELS = {
  partial_allowed: "Partial payments allowed",
  full_amount_or_more: "Full amount or more",
  exact_amount_only: "Exact amount only",
};

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// SF-2A's own /api/private-financing/accounts read model already computes every figure this panel
// displays (via computeAccountBalanceSummary, which replays the real event history server-side) -- this
// component only ever renders what the API returned. It never recomputes a balance in React.
export default function PrivateFinancingAccountsPanel() {
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "schema-unavailable" | "error"
  const [accounts, setAccounts] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [showHistoricalImport, setShowHistoricalImport] = useState(false);
  const requestInFlight = useRef(false);

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined; // never let a second Retry click overlap an in-flight request
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    return fetch("/api/private-financing/accounts")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (response.status === 503 && payload.code === "private_financing_schema_unavailable") {
          setStatus("schema-unavailable");
          return;
        }
        if (!response.ok) throw new Error(payload.error || "Unable to load private financing accounts.");
        setAccounts(payload.accounts || []);
        setStatus("available");
      })
      .catch((loadError) => {
        setErrorMessage(loadError.message);
        setStatus("error");
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Opening an account switches this SAME panel instance into detail mode -- the already-loaded
  // `accounts` list stays in memory untouched, so returning via Back never re-fetches or resets it
  // unnecessarily. The detail view manages its own loading/error/refresh lifecycle independently.
  if (selectedAccountId) {
    return (
      <section
        data-guided-workflow-panel
        aria-label="Private Financing account detail"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <PrivateFinancingAccountDetail accountId={selectedAccountId} onBack={() => setSelectedAccountId(null)} />
      </section>
    );
  }

  if (showHistoricalImport) {
    return (
      <section data-guided-workflow-panel aria-label="Private Financing historical import" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <PrivateFinancingHistoricalImport onBack={() => setShowHistoricalImport(false)} onImported={() => load()} />
      </section>
    );
  }

  return (
    <section
      data-guided-workflow-panel
      aria-label="Private Financing accounts"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Money</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Private Financing</h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
        Seller-financed and personal-loan accounts you administer directly, separate from rent collection.
      </p>
      <button type="button" onClick={() => setShowHistoricalImport(true)} data-guided-workflow-control="open-historical-import" className={`mt-5 rounded-xl px-4 py-2 text-sm font-bold ${goldControlClassName} ${FOCUS_RING}`}>
        Import historical plan
      </button>

      {status === "loading" ? (
        <p role="status" className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Loading private financing accounts…
        </p>
      ) : null}

      {status === "schema-unavailable" ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30" role="alert">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            Private Financing has not been activated for this environment yet.
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            The database foundation for this feature has not been turned on here. This is different from having zero
            accounts — nothing has actually been checked yet.
          </p>
          <button
            type="button"
            data-guided-workflow-control="retry"
            onClick={load}
            className={`mt-4 rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40 ${FOCUS_RING}`}
          >
            Retry
          </button>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/30">
          <p role="alert" className="text-sm font-bold text-red-800 dark:text-red-300">
            {errorMessage || "Something went wrong loading private financing accounts."}
          </p>
          <button
            type="button"
            data-guided-workflow-control="retry"
            onClick={load}
            className={`mt-4 rounded-xl border border-red-400 px-4 py-2 text-sm font-bold text-red-800 transition hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40 ${FOCUS_RING}`}
          >
            Retry
          </button>
        </div>
      ) : null}

      {status === "available" && accounts.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No private financing accounts yet.</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Load an approved JSON plan to create one through the controlled historical-import workflow.
          </p>
        </div>
      ) : null}

      {status === "available" && accounts.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} onOpen={() => setSelectedAccountId(account.id)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AccountRow({ account, onOpen }) {
  const balance = account.balance;
  return (
    <li className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-slate-950 dark:text-white">{account.borrowerLabel || "No borrower yet"}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {PRODUCT_LABELS[account.product] || account.product} · {STATUS_LABELS[account.status] || account.status}
          </p>
        </div>
        <button
          type="button"
          data-guided-workflow-control="open-account"
          onClick={onOpen}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${goldControlClassName} ${FOCUS_RING}`}
        >
          Open
        </button>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "Regular scheduled payment" is the contractual figure only -- never labeled as a calculated
            present obligation. This schema has no due-schedule engine yet, so "current amount due,"
            "past-due status," and "due date" are shown separately, honestly, as not tracked. */}
        <Fact term="Regular scheduled payment" value={centsToMoney(balance?.regularScheduledPaymentCents)} />
        <Fact term="Current amount due" value="Not tracked yet" />
        <Fact term="Due date" value="Not tracked yet" />
        <Fact term="Principal remaining" value={centsToMoney(balance?.totalPrincipalRemainingCents)} />
        <Fact term="Past-due status" value="Not tracked yet" />
        <Fact term="Payment-acceptance policy" value={POLICY_LABELS[account.paymentAcceptancePolicy] || "Not set"} />
      </dl>
    </li>
  );
}

function Fact({ term, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt>
      <dd className="mt-1 font-bold text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}
