"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import PrivateFinancingBorrowerPayment from "./PrivateFinancingBorrowerPayment";
import PrivateFinancingBorrowerProgress from "./PrivateFinancingBorrowerProgress";
import PrivateFinancingBorrowerMessages from "./PrivateFinancingBorrowerMessages";
import PrivateFinancingBorrowerAutopay from "./PrivateFinancingBorrowerAutopay";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (cents) => money.format(Number(cents || 0) / 100);

// The portal's own error payloads carry borrower-actionable context (which invitation, which account,
// an access code) that a generic error box must not swallow -- so a non-OK response rides through the
// data channel as a tagged status (the error channel only keeps the message string), while genuine
// fetch failures still surface through the hook's loadError.
async function fetchPortal(search) {
  const response = await fetch(`/api/private-financing/portal${search}`);
  const payload = await response.json();
  if (!response.ok) {
    return {
      status: "error",
      error: payload.error || "Unable to load your financing account.",
      signInUrl: payload.signInUrl,
      signedInEmail: payload.signedInEmail,
      invitedEmail: payload.invitedEmail,
      claimErrorCode: payload.claimErrorCode,
    };
  }
  return { status: "ok", ...payload };
}

export default function PrivateFinancingBorrowerPortal() {
  // Forward this page's own query string (the invited ?email=, carried here from the invitation
  // link) so the API can compare it against whoever actually authenticated, even on a direct
  // reload of this URL rather than a fresh click from the invitation email.
  const search = typeof window !== "undefined" ? window.location.search : "";
  // Stale-while-revalidate: the last loaded portal view stays on screen while a
  // refresh (payment, autopay change, Retry) runs in the background -- the
  // borrower never loses their place to a blank loading page.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `private-financing:borrower-portal:${search}`,
    () => fetchPortal(search),
    { ttlMs: 30_000 },
  );
  const portal = data?.status === "ok" ? data : null;
  const portalError = data?.status === "error" ? data : null;
  const [paying, setPaying] = useState(null);

  if (!data && isLoading) {
    return <main className="mx-auto max-w-5xl p-8"><ForgeLoadingState label="Loading your financing account…" /></main>;
  }
  if (portalError) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-3xl font-black">Private financing</h1>
        <p role="alert" className="mt-4">{portalError.error}</p>
        {portalError.signedInEmail ? <p className="mt-3 text-sm font-bold">Signed in as {portalError.signedInEmail}</p> : null}
        {portalError.invitedEmail ? <p className="mt-1 text-sm text-slate-600">This invitation was sent to {portalError.invitedEmail}.</p> : null}
        {portalError.claimErrorCode ? <p className="mt-2 text-xs text-slate-500">Access code: {portalError.claimErrorCode}</p> : null}
        <button type="button" onClick={() => refresh()} className="mt-4 mr-3 inline-block rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-800">Retry</button>
        {portalError.signInUrl ? <a className="mt-4 inline-block rounded-xl bg-blue-900 px-5 py-3 font-bold text-white" href={portalError.signInUrl}>Use a different account</a> : null}
      </main>
    );
  }
  if (!data && loadError) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <ForgeErrorState
          title="Unable to load your financing account."
          detail={loadError}
          onRetry={() => refresh()}
        />
      </main>
    );
  }
  if (!portal) return null;

  return (
    <main className="mx-auto max-w-5xl p-4 text-slate-950 sm:p-8">
      <h1 className="text-3xl font-black">Your private financing</h1>
      <p className="mt-2 text-sm text-slate-600">Signed in as {portal.email}</p>
      {isRefreshing ? <p role="status" className="mt-2 text-xs font-bold text-slate-400">Updating…</p> : null}
      {loadError ? (
        <p role="status" className="mt-2 text-xs font-bold text-slate-400">
          Could not refresh — showing your last loaded financing account.
        </p>
      ) : null}
      {portal.accounts.length === 0 ? (
        <div className="mt-6 rounded-xl border p-5">
          {portal.mismatched ? (
            <>
              <p role="alert" className="font-bold">
                This invitation was sent to {portal.invitedEmail}, but you&apos;re signed in as {portal.email}.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Sign out and sign in with {portal.invitedEmail} to continue, or ask the account owner to resend
                the invitation to the right address.
              </p>
              <a className="mt-4 inline-block rounded-xl bg-blue-900 px-5 py-3 font-bold text-white" href={`/auth?next=${encodeURIComponent("/forge/private-financing/portal")}&email=${encodeURIComponent(portal.invitedEmail)}`}>
                Use a different account
              </a>
            </>
          ) : (
            <p>No invitation matches this signed-in email.</p>
          )}
        </div>
      ) : portal.accounts.map(({ account, role, summary, events, regularScheduledPaymentCents, projection, progressAvailable = true, summaryAvailable = true, onlinePaymentsEnabled, pendingPayment, autopayEnrollments = [] }) => (
        <section key={account.id} className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="flex justify-between gap-4">
            <h2 className="text-xl font-black">Financing account</h2>
            <span className="font-bold capitalize">{account.status}</span>
          </div>
          <p className="mt-1 text-sm capitalize">{role.replaceAll("_", " ")}</p>
          {summaryAvailable && summary ? (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Original principal" value={dollars(account.origination_principal_cents)} />
              <Fact label="Principal remaining" value={dollars(summary.principalRemainingCents)} />
              <Fact label="Payments recorded" value={summary.paymentCount} />
              <Fact label="Total payments" value={dollars(summary.totalPaidCents)} />
            </dl>
          ) : (
            <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              Your current balance cannot be safely displayed right now. This has been logged for review --
              please contact support before making a payment based on any balance shown elsewhere.
            </p>
          )}

          {summaryAvailable && progressAvailable ? (
            <PrivateFinancingBorrowerProgress
              account={account}
              summary={summary}
              regularScheduledPaymentCents={regularScheduledPaymentCents}
              projection={projection}
            />
          ) : summaryAvailable ? (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Your current balance and payment history are available. The optional payoff chart is temporarily unavailable.
            </p>
          ) : null}

          {!summaryAvailable ? null : onlinePaymentsEnabled ? (
            paying === account.id ? (
              <PrivateFinancingBorrowerPayment accountId={account.id} regularScheduledPaymentCents={regularScheduledPaymentCents}
                pendingPayment={pendingPayment}
                autopayChargeDay={(autopayEnrollments || []).find((enrollment) => enrollment.status === "active")?.chargeDay}
                onCancel={() => { setPaying(null); refresh(); }} />
            ) : pendingPayment && !pendingPayment.resumable ? (
              <p className="mt-6 rounded-xl bg-slate-100 p-4 text-sm font-bold">A payment is currently processing for this account. Please check back shortly.</p>
            ) : (
              <button onClick={() => setPaying(account.id)} className="mt-6 rounded-xl bg-amber-500 px-5 py-3 font-black">
                {pendingPayment ? "Resume payment" : "Make a payment"}
              </button>
            )
          ) : (
            <p className="mt-6 rounded-xl bg-slate-100 p-4 text-sm">Online payments are not currently active for this account.</p>
          )}

          {summaryAvailable ? <PrivateFinancingBorrowerAutopay accountId={account.id} enrollments={autopayEnrollments}
            nextDueDate={projection?.seed?.firstProjectedPaymentDate ?? null} onChanged={() => refresh()} /> : null}

          <h3 className="mt-7 text-lg font-black">Payment history</h3>          <ol className="mt-3 divide-y">
            {events.filter((event) => event.event_type === "payment_posted").map((event) => (
              <li key={event.id} className="flex justify-between py-3"><span>{event.effective_date}</span><strong>{dollars(event.amount_cents)}</strong></li>
            ))}
          </ol>
        </section>
      ))}
      {portal.accounts.length > 0 ? <PrivateFinancingBorrowerMessages conversations={portal.conversations || []} onChanged={() => refresh()} /> : null}
    </main>
  );
}

function Fact({ label, value }) {
  return <div><dt className="text-xs font-bold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-lg font-black">{value}</dd></div>;
}
