"use client";

import { useEffect, useState } from "react";

// Rentec parity R22 — the applicant's no-login screening page content.
// Fetches the tokenized link state, collects screening info + consent.
// No report is ever pulled here; the data waits for the owner's manual review.

const inputClass = "w-full rounded border border-gray-300 px-3 py-2 text-sm";

export default function ScreeningApplicantForm({ token }) {
  const [state, setState] = useState({ loading: true, error: null, link: null });
  const [form, setForm] = useState({ fullName: "", phone: "", address: "", dateOfBirth: "", ssnLast4: "", consent: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rental/screening-public/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!cancelled) {
          if (!res.ok) setState({ loading: false, error: data.error || "This link is not valid.", link: null });
          else setState({ loading: false, error: null, link: data });
        }
      } catch {
        if (!cancelled) setState({ loading: false, error: "Unable to load this page. Check your connection and try again.", link: null });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/rental/screening-public/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Submission failed.");
      } else {
        setDone(true);
      }
    } catch {
      setSubmitError("Submission failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.loading) {
    return <div className="mx-auto max-w-xl p-6 text-sm text-gray-600">Loading…</div>;
  }
  if (state.error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Screening link</h1>
        <p className="mt-2 text-sm text-red-700">{state.error}</p>
        <p className="mt-2 text-sm text-gray-600">If you believe this is a mistake, contact the property owner for a new link.</p>
      </div>
    );
  }
  if (done || (state.link?.consentRecorded && state.link?.infoReceived)) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Screening information received</h1>
        <p className="mt-2 text-sm text-gray-700">
          Thank you — your information and consent have been recorded. The property owner will review
          your application. No screening report is pulled automatically from this page.
        </p>
      </div>
    );
  }
  if (!state.link?.acceptsSubmissions) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Screening closed</h1>
        <p className="mt-2 text-sm text-gray-600">This screening is closed. Please contact the property owner directly.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold">Tenant screening</h1>
      <p className="mt-1 text-sm text-gray-600">
        The property owner has requested screening as part of your rental application. Fill in the
        information below and confirm your consent. Nothing is pulled automatically — the owner
        reviews what you provide.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="font-medium">Full legal name</span>
          <input className={inputClass} value={form.fullName} onChange={set("fullName")} autoComplete="name" />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Phone</span>
          <input className={inputClass} value={form.phone} onChange={set("phone")} autoComplete="tel" />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Current address</span>
          <input className={inputClass} value={form.address} onChange={set("address")} autoComplete="street-address" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium">Date of birth <span className="text-gray-500">(optional)</span></span>
            <input type="date" className={inputClass} value={form.dateOfBirth} onChange={set("dateOfBirth")} />
          </label>
          <label className="block text-sm">
            <span className="font-medium">SSN last 4 <span className="text-gray-500">(optional)</span></span>
            <input className={inputClass} value={form.ssnLast4} onChange={set("ssnLast4")} inputMode="numeric" maxLength={4} placeholder="1234" />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.consent} onChange={set("consent")} />
          <span>
            I authorize the property owner to run tenant screening (credit, criminal, and eviction
            history) as part of my rental application.
          </span>
        </label>
        {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
        <button
          type="submit"
          disabled={submitting || !form.consent}
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit screening information"}
        </button>
      </form>
    </div>
  );
}
