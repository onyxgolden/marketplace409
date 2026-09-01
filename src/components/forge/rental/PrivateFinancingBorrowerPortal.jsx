"use client";
import { useEffect, useState } from "react";
import PrivateFinancingBorrowerPayment from "./PrivateFinancingBorrowerPayment";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (c) => money.format(Number(c || 0) / 100);

export default function PrivateFinancingBorrowerPortal() {
  const [state, setState] = useState({ loading: true });
  const [paying, setPaying] = useState(null);

  useEffect(() => {
    // Forward this page's own query string (the invited ?email=, carried here from the invitation
    // link) so the API can compare it against whoever actually authenticated, even on a direct
    // reload of this URL rather than a fresh click from the invitation email.
    const search = typeof window !== "undefined" ? window.location.search : "";
    fetch(`/api/private-financing/portal${search}`)
      .then(async (r) => ({ r, p: await r.json() }))
      .then(({ r, p }) => setState(r.ok ? { data: p } : {
        error: p.error, signInUrl: p.signInUrl, signedInEmail: p.signedInEmail,
        invitedEmail: p.invitedEmail, claimErrorCode: p.claimErrorCode,
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
        {state.invitedEmail ? <p className="mt-1 text-sm text-slate-600">This invitation was sent to {state.invitedEmail}.</p> : null}
        {state.claimErrorCode ? <p className="mt-2 text-xs text-slate-500">Access code: {state.claimErrorCode}</p> : null}
        {state.signInUrl ? <a className="mt-4 inline-block rounded-xl bg-blue-900 px-5 py-3 font-bold text-white" href={state.signInUrl}>Use a different account</a> : null}
      </main>
    );
  }

  const { data } = state;
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-black">Your private financing</h1>
      <p className="mt-2 text-sm text-slate-600">Signed in as {data.email}</p>

      {data.accounts.length === 0 ? (
        <div className="mt-6 rounded-xl border p-5">
          {data.mismatched ? (
            <>
              <p role="alert" className="font-bold">
                This invitation was sent to {data.invitedEmail}, but you&apos;re signed in as {data.email}.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Sign out and sign in with {data.invitedEmail} to continue, or ask the account owner to resend
                the invitation to the right address.
              </p>
              <a className="mt-4 inline-block rounded-xl bg-blue-900 px-5 py-3 font-bold text-white" href={`/auth?next=${encodeURIComponent("/forge/private-financing/portal")}&email=${encodeURIComponent(data.invitedEmail)}`}>
                Use a different account
              </a>
            </>
          ) : (
            <p>No invitation matches this signed-in email.</p>
          )}
        </div>
      ) : data.accounts.map(({ account, role, summary, events, regularScheduledPaymentCents, onlinePaymentsEnabled }) => (
        <section key={account.id} className="mt-6 rounded-2xl border p-6">
          <div className="flex justify-between">
            <h2 className="text-xl font-black">Financing account</h2>
            <span className="font-bold capitalize">{account.status}</span>
          </div>
          <p className="mt-1 text-sm capitalize">{role.replaceAll("_", " ")}</p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact t="Original principal" v={dollars(account.origination_principal_cents)} />
            <Fact t="Principal remaining" v={dollars(summary.principalRemainingCents)} />
            <Fact t="Payments recorded" v={summary.paymentCount} />
            <Fact t="Total payments" v={dollars(summary.totalPaidCents)} />
            <Fact t="Interest paid" v={dollars(summary.interestPaidCents)} />
          </dl>
          {onlinePaymentsEnabled ? (
            paying === account.id
              ? <PrivateFinancingBorrowerPayment accountId={account.id} regularScheduledPaymentCents={regularScheduledPaymentCents} onCancel={() => setPaying(null)} />
              : <button onClick={() => setPaying(account.id)} className="mt-6 rounded-xl bg-amber-500 px-5 py-3 font-black">Make a payment</button>
          ) : (
            <p className="mt-6 rounded-xl bg-slate-100 p-4 text-sm">Online payments are not currently active for this account.</p>
          )}
          <h3 className="mt-7 text-lg font-black">Payment history</h3>
          <ol className="mt-3 divide-y">
            {events.filter((e) => e.event_type === "payment_posted").map((e) => (
              <li key={e.id} className="flex justify-between py-3">
                <span>{e.effective_date}</span>
                <strong>{dollars(e.amount_cents)}</strong>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}

function Fact({ t, v }) {
  return <div><dt className="text-xs font-bold uppercase text-slate-500">{t}</dt><dd className="mt-1 text-lg font-black">{v}</dd></div>;
}
