"use client";

import { useEffect, useState } from "react";
import PrivateFinancingBorrowerPayment from "./PrivateFinancingBorrowerPayment";
import PrivateFinancingBorrowerProgress from "./PrivateFinancingBorrowerProgress";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (cents) => money.format(Number(cents || 0) / 100);

export default function PrivateFinancingBorrowerPortal() {
  const [state, setState] = useState({ loading: true });
  const [paying, setPaying] = useState(null);

  useEffect(() => {
    fetch("/api/private-financing/portal")
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => setState(response.ok ? { data: payload } : {
        error: payload.error,
        signInUrl: payload.signInUrl,
        signedInEmail: payload.signedInEmail,
        claimErrorCode: payload.claimErrorCode,
      }))
      .catch(() => setState({ error: "Unable to load your financing account." }));
  }, []);

  if (state.loading) {
    return <main className="mx-auto max-w-5xl p-8"><p role="status">Loading your financing account…</p></main>;
  }
  if (state.error) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-3xl font-black">Private financing</h1>
        <p role="alert" className="mt-4">{state.error}</p>
        {state.signedInEmail ? <p className="mt-3 text-sm font-bold">Signed in as {state.signedInEmail}</p> : null}
        {state.claimErrorCode ? <p className="mt-2 text-xs text-slate-500">Access code: {state.claimErrorCode}</p> : null}
        <a className="mt-4 mr-3 inline-block rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-800" href="/forge/private-financing/portal">Retry</a>
        {state.signInUrl ? <a className="mt-4 inline-block rounded-xl bg-blue-900 px-5 py-3 font-bold text-white" href={state.signInUrl}>Use a different account</a> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 text-slate-950 sm:p-8">
      <h1 className="text-3xl font-black">Your private financing</h1>
      <p className="mt-2 text-sm text-slate-600">Signed in as {state.data.email}</p>
      {state.data.accounts.length === 0 ? (
        <p className="mt-6 rounded-xl border p-5">No invitation matches this signed-in email.</p>
      ) : state.data.accounts.map(({ account, role, summary, events, regularScheduledPaymentCents, projection, progressAvailable = true, onlinePaymentsEnabled }) => (
        <section key={account.id} className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="flex justify-between gap-4">
            <h2 className="text-xl font-black">Financing account</h2>
            <span className="font-bold capitalize">{account.status}</span>
          </div>
          <p className="mt-1 text-sm capitalize">{role.replaceAll("_", " ")}</p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Original principal" value={dollars(account.origination_principal_cents)} />
            <Fact label="Principal remaining" value={dollars(summary.principalRemainingCents)} />
            <Fact label="Payments recorded" value={summary.paymentCount} />
            <Fact label="Total payments" value={dollars(summary.totalPaidCents)} />
          </dl>

          {progressAvailable ? (
            <PrivateFinancingBorrowerProgress
              account={account}
              summary={summary}
              regularScheduledPaymentCents={regularScheduledPaymentCents}
              projection={projection}
            />
          ) : (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Your current balance and payment history are available. The optional payoff chart is temporarily unavailable.
            </p>
          )}

          {onlinePaymentsEnabled ? (
            paying === account.id ? (
              <PrivateFinancingBorrowerPayment accountId={account.id} regularScheduledPaymentCents={regularScheduledPaymentCents} onCancel={() => setPaying(null)} />
            ) : (
              <button onClick={() => setPaying(account.id)} className="mt-6 rounded-xl bg-amber-500 px-5 py-3 font-black">Make a payment</button>
            )
          ) : (
            <p className="mt-6 rounded-xl bg-slate-100 p-4 text-sm">Online payments are not currently active for this account.</p>
          )}

          <h3 className="mt-7 text-lg font-black">Payment history</h3>
          <ol className="mt-3 divide-y">
            {events.filter((event) => event.event_type === "payment_posted").map((event) => (
              <li key={event.id} className="flex justify-between py-3"><span>{event.effective_date}</span><strong>{dollars(event.amount_cents)}</strong></li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}

function Fact({ label, value }) {
  return <div><dt className="text-xs font-bold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-lg font-black">{value}</dd></div>;
}
